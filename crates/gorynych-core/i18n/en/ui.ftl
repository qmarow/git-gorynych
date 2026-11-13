# Интерфейс (src/). Ключ — по английскому тексту; { $a0 }, { $a1 }… — аргументы t()/tj() по порядку.
# Сообщения без перевода на английский показываются по-русски.

## src/App.tsx

switching-branch = Switching branch…
switching-to-commit = Switching to commit…
pulling-changes-from-server = Pulling changes from the server…
pushing-to-server = Pushing to the server…
fetching-from-server = Fetching from the server…
merging-branches = Merging branches…
rebasing = Rebasing…
applying-rebase = Applying rebase…
creating-revert-commit = Creating a revert commit…
restoring-project-files = Restoring project files…
moving-branch = Moving the branch…
stashing-changes = Stashing changes…
applying-stash = Applying stash…
undoing = Undoing…
redoing = Redoing…
creating-branch = Creating branch…
continuing = Continuing…
aborting = Aborting…
new-tab = New tab
choose-project-folder-to-connect = Choose the project folder to connect to a repository
choose-project-folder-for-new = Choose the project folder for the new repository
is-already-git-repository-opening = { $a0 } is already a Git repository — opening it
branch-2 = branch { $a0 }
history-loaded-from-server = history loaded from the server
added-from-server = added from the server: { $a0 } { $a1 }
file = file
files-2 = files
files = files
commit-2 = commit { $a0 } ({ $a1 } { $a2 })
pushed-to-server = pushed to the server
connected-to = { $a0 } connected to { $a1 }
repository-is-connected-but-push = The repository is connected, but push failed: { $a0 }
commit-is-saved-locally-you = { $a0 } The commit is saved locally — you can push it later with the Push button.
repository-created = Repository { $a0 } created
commit-skipped-no-files = commit skipped — no files
open-repository = Open repository…
create-repository = Create repository…
clone-repository = Clone repository…
connect-folder-to-gitlab-github = Connect a folder to GitLab / GitHub…
close-tab = Close tab
exit = Exit
sign-in = Sign in
remote-now-points-to = Remote { $a0 } now points to { $a1 }
added-remote = Added remote { $a0 }
pull-and-push-work-but = Pull and Push work, but CI/CD pipelines don't
signed-in-to-credentials-saved = Signed in to { $a0 } — credentials saved
same-sign-in-also-works = The same sign-in also works for CI/CD pipelines
shared-sign-in-for-removed = Shared sign-in for { $a0 } removed
server = server
sign-in-for-removed = Sign-in for { $a0 } removed
repository = repository
pull-updated-from = Pull: { $a0 } updated from { $a1 }
is-already-up-to-date = { $a0 } is already up to date
fetch-updated = Fetch: updated { $a0 }
upstream-set = {" "}(upstream set)
undone = Undone: { $a0 }
redone = Redone: { $a0 }
switching-to = Switching to { $a0 }
created-branch-tracking = Created branch { $a0 }, tracking { $a1 }
changes-in-stashed-theyll-come = changes in { $a0 } stashed ({ $a1 }) — they'll come back when you return
changes-in-restored = changes in { $a0 } restored
changes-moved = changes moved ({ $a0 })
changes-discarded-ctrl-z-brings = changes discarded ({ $a0 }) — Ctrl+Z brings them back
changes-of-branch-came-back = Changes of branch { $a0 } came back with a conflict
stash-is-kept-in-stashes = The stash is kept in the Stashes list. Resolve the conflicts in files marked U, or revert them and apply the stash later.
changes-moved-to-with-conflict = Changes moved to { $a0 } with a conflict
copy-of-changes-remains-in = A copy of the changes remains in the Stash list. Resolve the conflicts in files marked U.
stashed-changes-2 = Stashed changes: { $a0 }{ $a1 }
older-copy-with-same-changes = {" "}— the older copy with the same changes was removed
stash-applied = Stash applied
branch-created = Branch { $a0 } created{ $a1 }
and-checked-out = {" "}and checked out
creating-branch-2 = Creating branch { $a0 }
branch-created-and-checked-out = Branch { $a0 } created and checked out
commit-created = Commit { $a0 } created
copied = { $a0 } copied
couldnt-copy-to-clipboard = Couldn't copy to the clipboard
tag-created-on = Tag { $a0 } created on { $a1 }
delete-branch-2 = Delete branch
branch-deleted-undo-brings-it = Branch { $a0 } deleted (Undo brings it back)
branch-not-merged = Branch not merged
force-delete = Force delete { $a0 }
reset-to = { $a0 } reset to { $a1 } (--{ $a2 })
branch-will-be-moved-to = Branch { $a0 } will be moved to { $a1 } "{ $a2 }".{ $a3 } Commits after this point can be restored with Undo.
uncommitted-changes-will-be-lost = {" "}Uncommitted changes ({ $a0 }) will be lost permanently.
copy-name = Copy name
name-2 = Name
tag-3 = Tag { $a0 }
delete-tag-2 = Delete tag { $a0 }…
delete-tag-3 = Delete tag
delete-local-tag = Delete the local tag "{ $a0 }"?
delete-2 = Delete
delete-tag-4 = Delete tag
tag-deleted = Tag { $a0 } deleted
branch-3 = Branch { $a0 } = { $a1 }
branch-4 = Branch { $a0 }
switch-to = Switch to { $a0 }
update-branch = Update branch — ↓{ $a0 }
update-branch-2 = Update branch
no-new-commits-in = No new commits in { $a0 }
has-its-own-commits-switch = { $a0 } has its own commits (↑{ $a1 }) — switch to it and Pull
pull-from = Pull { $a0 } { $a1 } from { $a2 }
commit = commit
commits = commits
commits-2 = commits
fast-forward-to-without-switching = Fast-forward { $a0 } to { $a1 } without switching branches
merge-into = Merge { $a0 } into { $a1 }
merged-into = { $a0 } merged into { $a1 }
rebase-onto-2 = Rebase { $a0 } onto { $a1 }…
with-preview-resulting-graph-conflicts = With preview: the resulting graph, conflicts and changes are visible before applying
reset-to-2 = Reset { $a0 } to { $a1 }
rename-2 = Rename…
delete-branch-3 = Delete branch { $a0 }…
cant-delete-current-branch = Can't delete the current branch
delete-local-branch-branch-on = Delete the local branch. The branch on the server is not affected.
delete-branch-4 = Delete branch
delete-local-branch-undo-can = Delete the local branch "{ $a0 }"? { $a1 } Undo can bring it back.
branch-on-server-is-not = Branch { $a0 } on the server is not affected.
delete-from-server-2 = Delete { $a0 } from the server…
delete-branch-on-server-git = Delete the branch on the server (git push --delete). The local branch stays.
on-server = On the server: { $a0 }
local-branch-already-exists-but = A local branch { $a0 } already exists but points to another commit — after switching, Pull to get the changes
create-local-and-switch-to = Create local { $a0 } and switch to it
delete-branch-on-server-git-push = Delete the branch on the server (git push --delete) — for everyone working with the repository
soft-keep-all-changes-in = Soft — keep all changes in the index
mixed-keep-changes-in-working = Mixed — keep changes in the working folder
hard-discard-all-changes = Hard — discard all changes…
rename-3 = Rename
branch-renamed-to-undo-reverts = Branch { $a0 } renamed to { $a1 } — Undo reverts it
delete-from-server-3 = Delete from server
deleting-from-server = Deleting { $a0 } from the server…
branch-deleted-from-undo-restores = Branch { $a0 } deleted from { $a1 } — Undo restores it on the server
update = Update { $a0 }
updating = Updating { $a0 }…
from-3 = { $a0 }: +{ $a1 } { $a2 } from { $a3 }{ $a4 }
without-switching = {" "}(without switching)
commit-hash = Commit hash
copy-commit-hash-sha = Copy the commit hash (SHA)
new-local = new local
check-out-this-commit = Check out this commit
head-at-detached-undo-returns = HEAD at { $a0 } (detached) — Undo returns to the branch
create-branch-here = Create branch here…
create-tag-here = Create tag here…
cherry-pick-commit-into = Cherry-pick commit into { $a0 }
commit-applied-to = Commit { $a0 } applied to { $a1 }
revert-commit-changes = Revert commit changes
created-revert-commit-for = Created a revert commit for { $a0 }
restore-files-from-commit = Restore files from commit…
new-commit-in-which-all = A new commit in which all project files are as in this commit. History isn't rewritten, the branch isn't switched.
reset-to-this-commit = Reset { $a0 } to this commit
local = local
on-server-2 = on the server
copy-commit-hash = Copy commit hash
copy-commit-message = Copy commit message
commit-message = Commit message
rebase-works-on-branch = Rebase works on a branch
youre-on-detached-head-switch = You're on a detached HEAD — switch to a branch.
amend-last-commit = Amend last commit…
edit-commits-of-branch = Edit commits of branch { $a0 }
reorder-reword-squash-or-drop = Reorder, reword, squash or drop commits — with a preview before applying
commits-after = Commits after { $a0 }…
starting-from-inclusive = Starting from { $a0 } (inclusive)…
rebase-onto-this-commit = Rebase { $a0 } onto this commit…
with-preview-of-result-before = With a preview of the result before applying
compare-with-marked = Compare with marked { $a0 }
compare-with-head = Compare with HEAD
unmark-for-comparison = Unmark for comparison
mark-for-comparison = Mark for comparison
ctrl-click = Ctrl+click
marked-for-comparison = { $a0 } marked for comparison
ctrl-click-or-right-click = Ctrl+click or right-click another commit → "Compare with marked"
already-on-this-branch = already on this branch
branch-not-found-2 = Branch { $a0 } not found
check-name-or-fetch = Check the name or Fetch.
already-contains-all-commits = already contains all commits
already-merged = already merged
nothing-to-stash = nothing to stash
stash-is-empty = stash is empty
empty-commit-message = Empty commit message
no-changes-to-commit = No changes to commit
commit-cancelled-after-check = Commit cancelled after check
active-branch-is-required = An active branch is required
gitlab-is-not-connected = GitLab is not connected
settings-connections-add-token-with = Settings → Connections: add a token with the "api" scope.
created = created
already-existed = already existed
pull-request-page-opened = pull request page opened
couldnt-determine-server-for-merge = Couldn't determine the server for the merge request
gitlab-via-token-and-github = GitLab (via token) and GitHub (opens the PR page) are supported.
continue = Continue?
stopped-by-you = Stopped by you
unknown-step = Unknown step: { $a0 }
each-step-can-be-undone = each step can be undone with Undo
open-action-builder-and-fix = Open the action builder and fix the steps.
wait-for-current-operation-to = Wait for the current operation to finish
already-in-nothing-to-merge = Already in { $a0 } — nothing to merge
fast-forward = Fast-forward { $a0 }
branch-simply-moves-forward-no = The branch simply moves forward — no merge commit and no switching
fast-forwarded-to-undo-reverts = { $a0 } fast-forwarded to { $a1 } — Undo reverts it
merge-into-2 = Merge into { $a0 }
switches-branch = switches branch
merged-into-undo-reverts-it = { $a0 } merged into { $a1 } — Undo reverts it
cherry-pick-commit-into-2 = Cherry-pick commit into { $a0 }
one-commit = one commit
rebase-onto-3 = Rebase { $a0 } onto { $a1 }…
with-preview = with preview
cant-merge-branch-into-itself = Can't merge a branch into itself
my-actions = My actions
untitled = Untitled
action-builder = Action builder…
changes = Changes: { $a0 }
stash-all-changes = Stash all changes
stage-all-changes = Stage all changes
discard-all-changes = Discard all changes
discard-all-changes-2 = Discard all changes
all-uncommitted-changes-including-new = All uncommitted changes, including new untracked files, will be deleted permanently.
discard-changes-2 = Discard changes
discarded-changes-in-files = Discarded changes in { $a0 } files
undo = Undo: { $a0 }
undo-2 = Undo
redo = Redo: { $a0 }
redo-2 = Redo
find-commit = Find commit…
switch-branch = Switch branch…
new-branch = New branch…
stash-changes = Stash changes
pop-last-stash = Pop the last stash
appearance = Appearance…
sync = Sync…
connections-git-servers-and-gitlab = Connections: Git servers and GitLab…
repository-sign-in = Repository sign-in…
save-and-check = Save and check
guide = Guide
keyboard-shortcuts = Keyboard shortcuts
about-2 = About
conflicts = Conflicts: { $a0 } { $a1 }
pick-version-you-need-for = Pick the version you need for each block and save — then click "Continue".
resolved = { $a0 } — resolved
files-left = Files left: { $a0 }
all-conflicts-resolved = All conflicts resolved
click-continue-in-yellow-bar = Click "Continue" in the yellow bar to finish { $a0 }.
changes-are-ready-you-can = The changes are ready — you can commit.
pipeline-2 = { $a0 } Pipeline #{ $a1 } { $a2 }
passed = passed
failed = failed
canceled = canceled
open = Open
restore-file = Restore file
no-commit = { $a0 }: { $a1 } — no commit{ $a2 }
deleted-it-didnt-exist-in = deleted (it didn't exist in that version)
version = version { $a0 } { $a1 }
before = before
from = from
undo-reverts-it = , Undo reverts it
file-has-uncommitted-changes = The file has uncommitted changes
file-is-already-changed-in = File { $a0 } is already changed in the working folder. It will be replaced with the version { $a1 } commit { $a2 }. Undo (Ctrl+Z) brings back the current content.
replace = Replace
revert-hunk = Revert hunk
in-no-commit-undo-reverts = { $a0 } in { $a1 } — no commit, Undo reverts it
commit-changes-reverted = Commit changes reverted
hunk-reverted = Hunk reverted
in-discarded-undo-brings-it = { $a0 } in { $a1 } discarded — Undo brings it back
changes-2 = Changes
hunk = Hunk
stage-hunk = Stage hunk
unstage-hunk = Unstage hunk
hunk-from-stash = Hunk from stash
from-stash-applied-to-undo = { $a0 } from stash applied to { $a1 } — Undo reverts it
revert-in-working-folder = Revert in working folder
remove-this-hunks-changes-from = Remove this hunk's changes from the file in the working folder — no commit. Undo brings them back.
stage-2 = Stage
add-only-this-hunk-to = Add only this hunk to the commit (Stage)
discard-this-hunk-of-changes = Discard this hunk of changes. Undo brings it back.
unstage = Unstage
remove-this-hunk-from-commit = Remove this hunk from the commit (Unstage) (it stays in the working folder)
apply = Apply
move-only-this-hunk-from = Move only this hunk from the stash into the file in the working folder. The stash doesn't change, Undo reverts it.
resolve-conflict-first = Resolve the conflict first
file-isnt-committed-yet-it = The file isn't committed yet — it has no history
no-commit-2 = No commit
file-was-deleted-in-this = The file was deleted in this commit
file-history-log = File history (Log)
all-commits-that-changed-this = All commits that changed this file — including under previous names
who-last-changed-each-line = Who last changed each line and when
show-changes = Show changes
restore-file-from-stash = Restore file from stash
file-in-working-folder-will = The file in the working folder will become as in the stash. The stash stays in the list. Undo reverts it.
restore-file-to-its-version = Restore the file to its version in this commit
file-in-working-folder-will-become = The file in the working folder will become as in this commit. No commit is created.
restore-file-to-its-version-before = Restore the file to its version before this commit
file-will-become-as-it = The file will become as it was before this commit. No commit is created.
revert-this-commits-changes-in = Revert this commit's changes in the file
remove-from-working-file-only = Remove from the working file only what this commit changed — later edits stay
stage-3 = Stage
unstage-2 = Unstage
discard-changes-in-file = Discard changes in file
discard-unstaged-changes-of-this = Discard the unstaged changes of this file. Undo brings them back.
copy-path = Copy path
path = Path
delete-stash = Delete stash
delete-undo-can-bring-it = Delete "{ $a0 }"? Undo can bring it back.
stash-deleted-undo-brings-it = Stash deleted — Undo brings it back
stash-applied-and-deleted = Stash "{ $a0 }" applied and deleted
stash-applied-2 = Stash "{ $a0 }" applied
restore-from-stash = Restore from stash
from-in-working-folder = { $a0 } from { $a1 } — in the working folder{ $a2 }
undo-reverts-it-2 = {"."} Undo reverts it
replace-changed-files = Replace the changed files?
you-have-unsaved-changes-in = You have unsaved changes in { $a0 }. They'll be replaced with the version from { $a1 }. Undo (Ctrl+Z) brings back the current content.
file-3 = file { $a0 }
files-3 = { $a0 } files
apply-2 = Apply
apply-and-delete-pop = Apply and delete (Pop)
delete-drop = Delete (Drop)
revert-to-commit = Revert to commit
restoring-files-to = Restoring files to { $a0 }…
files-restored-to-created-commit = Files restored to { $a0 } — created commit "{ $a1 }". Undo reverts it.
and-more = {" "}and { $a0 } more
reverted-to-last-commit-by = { $a0 } — reverted to the last commit by another program, change removed from the index
changes-from-another-program-added = { $a0 } — changes from another program added to the index
updated-in-index = Updated in the index: { $a0 }
turn-off-settings-sync = Turn off: Settings → Sync
loading-repository = Loading repository…
starting = Starting…
copy-path-2 = Copy path
open-another-repository = Open another repository…
action-2 = Action
continue-2 = Continue
finished = { $a0 } finished
next-step = Next step
abort = Abort
aborted-state-restored = { $a0 } aborted, state restored
file-history = File history
restore-file-2 = Restore file…
restore-this-file-in-working = Restore this file in the working folder to its version in the commit or before it — no commit
rebase-of-done-undo-ctrl = Rebase of { $a0 } done — Undo (Ctrl+Z) restores the previous state
rebase-done-undo-ctrl-z = Rebase done — Undo (Ctrl+Z) restores the previous state
commit-isnt-in-loaded-history = The commit isn't in the loaded history
fetch-or-pull = Fetch or pull
pre-commit-check-enabled-for = Pre-commit check enabled for this repository
pre-commit-check-disabled-for = Pre-commit check disabled for this repository
turn-it-back-on-in = Turn it back on in the line above the Commit button or in the settings.
git-gorynych = git-Горыныч
about-version = Version 2.0.0-alpha.0 · Rust + Tauri + React + Tailwind CSS
commit-graph-branches-stash-conflicts = Commit graph, branches, stash, conflicts, CI/CD and GitLab pipelines — in one window.
ci-cd-token-for-removed = CI/CD token for { $a0 } removed
all-sign-ins-for-removed = All sign-ins for { $a0 } removed
repository-cloned = Repository { $a0 } cloned
changes-stashed = Changes stashed
in-progress = <0>{ $a1 }</0> in progress{ $a2 }
conflicts-left-to-resolve-then = {" "}— conflicts left to resolve: { $a0 }. Then click "Continue".
conflicts-resolved-you-can-continue = {" "}— conflicts resolved, you can continue.
there-are-conflicts-after-applying = There are conflicts after applying the stash: { $a0 }. Resolve them — then you can commit.
resolve-conflicts = Resolve conflicts
restore-everything-as-it-was = Restore everything as it was before the operation
open-repository-2 = Open a repository
choose-folder-with-local-git = Choose a folder with a local Git repository
loading = Loading…
open-repository-3 = Open repository
create-repository-in-project-folder = { $a0 }Create a repository in a project folder
connect-project-folder-to-gitlab = { $a0 }Connect a project folder to GitLab / GitHub
clone-repository-from-link = { $a0 }Clone a repository from a link
if-chosen-folder-has-no = { $a0 } If the chosen folder has no Git, the app will offer to initialize it.
ctrl-o-open-ctrl-n = Ctrl+O — open · Ctrl+N — create.
how-to-use-app-f1 = { $a0 } How to use the app (F1)

## src/boot.tsx

interface-crashed-with-error = The interface crashed with an error
reload = Reload
copy-error = Copy error

## src/components/ActionBuilder.tsx

new-action = New action
action-builder-2 = { $a0 }<1>Action builder</1>
new-action-2 = { $a0 } New action
ready-made-templates = Ready-made templates
changes-are-saved-immediately = <0>Changes are saved immediately</0>{ $a1 }
close-esc = Close (Esc)
copy-2 = { $a0 } (copy)
your-own-buttons-for-frequent = Your own buttons for frequent tasks
build-chain-of-steps-for = Build a chain of steps — for example, "create a branch from main, rebase, push, merge request" — and run it with one button on the toolbar or a keyboard shortcut.
empty-action = { $a0 } Empty action
icon = Icon
action-name = Action name
button-on-top-toolbar = Button on the top toolbar
ask-for-confirmation-before-running = Ask for confirmation before running
run-in-order-error-stops = { $a0 }<1>run in order; an error stops the chain</1>
steps = Steps
add-step = { $a0 } Add step
variables-in-fields = Variables in fields
copy-3 = Copy
will-ask-at-run-time = Will ask at run time: { $a0 }
delete-for-sure = Delete for sure?
copy-4 = { $a0 } Copy
run-2 = { $a0 } Run
drag-to-reorder = Drag to reorder
up = Up
down = Down
remove-step = Remove step
runs-as-is-undo-doesnt = { $a0 } Runs as is — Undo doesn't work for custom commands
which-step-to-add = <0>Which step to add?</0>{ $a1 }
keyboard-shortcut = { $a0 } Keyboard shortcut
press-shortcut-esc-cancel-backspace = Press a shortcut… (Esc — cancel, Backspace — remove)
none-click-to-assign = None — click to assign
remove-shortcut = Remove shortcut

## src/components/ActionRunner.tsx

retry-from-step = { $a0 } Retry from step { $a1 }
done-2 = Done{ $a0 }
cancel = Cancel

## src/components/AuthDialog.tsx

username-and-password = Username and password
access-token = Access token
ssh-key = SSH key
public-key-copied-to-clipboard = Public key copied to the clipboard
hide-2 = Hide
show = Show
repository-sign-in-2 = Repository sign-in
remove-shared-sign-in-for = Remove the shared sign-in for all repositories on { $a0 }
remove-this-repositorys-saved-sign = Remove this repository's saved sign-in
forget = { $a0 } Forget
done = Done
checking = Checking…
sign-in-and-retry = Sign in and retry
no-server-specified = No server specified
repository-without-remote = Repository without a remote
enter-your-servers-address-below = enter your server's address below
specify-where-its-hosted-remote = specify where it's hosted — remote origin will be added
repository-address = Repository address
will-be-added-as-origin = will be added as origin
add-project-path = Add the project path: <0>{ $a1 }</0>
group-project = group/project
on-save-remote-will-change = On save, remote { $a0 } will change:
on-save-remote-origin-will = On save, remote origin will be added:
address-is-ssh-username-password = The address is SSH: username, password and token aren't used for it
address-is-https-ssh-key = The address is HTTPS: an SSH key isn't used for it
address-starts-with-https-ssh = The address starts with https:// — an SSH key isn't used for it. Sign in with a username and password or a token, or switch the address to SSH.
address-is-ssh-git-it = The address is SSH (git@…): it needs an SSH key. Username, password and token work only with https:// addresses.
switch-address-to-ssh = Switch the address to SSH
switch-address-to-https = Switch the address to HTTPS
username = Username
username-2 = Username
password = Password
saved-type-to-replace = •••••• saved — type to replace
password-2 = Password
with-two-factor-authentication-doesnt = { $a0 } with two-factor authentication doesn't accept a regular password for Git — use the "Access token" tab.
saved-paste-to-replace = •••••• saved — paste to replace
token = Token
optional = optional
default = default: { $a0 }
username-for-token = Username for the token
requires-scopes = Requires the { $a0 } scopes.
and = {" "}and{" "}
requires-token-with-write-access = Requires a token with write access to the repository.
create-token = Create a token { $a0 }
this-same-sign-in-also = { $a0 }<1>This same sign-in also works for CI/CD pipelines — no separate sign-in needed. { $a2 }</1>
existing-key = Existing key
create-new-key = Create a new key
private-key-2 = Private key
looking-for-keys-in-ssh = { $a0 } Looking for keys in ~/.ssh…
no-keys-found-in-choose = No keys found in { $a0 } — choose a file or { $a1 }.
create-new-key-2 = create a new key
no-key-selected = no key selected
file-4 = { $a0 } File…
copy-public-part-pub-to = Copy the public part (.pub) — to add it on the server
key-passphrase = Key passphrase
if-key-is-protected-by = if the key is protected by a passphrase
saved = •••••• saved
key-passphrase-2 = Key passphrase
ci-cd-pipelines-optional = { $a0 } CI/CD pipelines<1>— optional</1>
accepts-it-for-pull-push = { $a0 } { $a1 } accepts it for Pull/Push, but not for the API. To make this same sign-in open pipelines too, add a token — it will be saved with it. { $a2 }{ $a3 }
token-for-pipelines = Token for pipelines
theyre-tied-to-repository-on = { $a0 } They're tied to repository <1>{ $a2 }</1> on { $a3 } — other repositories on this server won't get them. Git receives them directly, without sign-in windows.{ $a4 }{ $a5 }
credentials = The credentials
server-2 = server
currently-saved = Currently saved: { $a0 }{ $a1 }{ $a2 }.
shared-sign-in-for-all = A shared sign-in for all of { $a0 } ({ $a1 }{ $a2 }), saved earlier, is currently in effect. After saving, this repository will have its own.
username-and-password-2 = username and password
token-2 = token
api-scope-covers-everything = The api scope covers everything.
token-needs-repo-and-workflow-scopes = The token needs the repo and workflow scopes (for runners and secrets — repository admin).
token-needs-write-repository-scope = The token needs the write:repository scope.
app-password-needs-pipelines-and = The app password needs the Pipelines and Repositories permissions.
ci-cd-pipelines-work-with = { $a0 } CI/CD pipelines work with this sign-in{ $a1 }.
ci-cd-pipelines-dont-open = CI/CD pipelines don't open with this sign-in — a token is needed.
own-server = Own server
where-repository-is-hosted = Where the repository is hosted
address-is-set-in-clone = The address is set in the clone window
server-address = Server address
from-repository-link = from the repository link
domain-optionally-with-port = domain, optionally with a port
previously = Previously:{ $a0 }
chosen-by-you = chosen by you
detecting-from-server-response = { $a0 } detecting from the server response…
detected-from-server-response = { $a0 } detected from the server response{ $a1 }
choose-type-manually = { $a0 } — choose the type manually
server-didnt-respond-2 = The server didn't respond
remembered-for-this-server = remembered for this server
by-server-address = by server address
server-type = <0>Server type</0>{ $a1 }{ $a2 }
server-type-2 = Server type
not-selected = not selected
recommended = recommended
for-old-servers = for old servers
file-name = File name
key-file-name = Key file name
comment = Comment
usually-email-to-recognize-key = usually an email — to recognize the key in the server's list
key-comment = Key comment
new-key-passphrase = New key passphrase
repeat-passphrase = Repeat passphrase
repeat-key-passphrase = Repeat key passphrase
passphrases-dont-match = The passphrases don't match
file-name-only-no-folders = File name only — no folders and no .pub
key-passphrase-will-be-saved = The key passphrase will be saved encrypted — you won't have to enter it for every operation.
without-passphrase-key-is-protected = Without a passphrase the key is protected only by file permissions. Existing keys aren't overwritten.
create-key = { $a0 } Create key
key-created = { $a0 }<1>Key <2>{ $a3 }</2> created<4> · { $a5 }</4></1>{ $a6 }
another-one = another one
public-key = Public key
copied-to-clipboard = Copied to the clipboard
open-ssh-keys-on = { $a0 } Open SSH Keys on { $a1 }
add-public-key-on-server = Add the public key on the server: { $a0 } → paste from the clipboard → Add key.
button-above = the button above
profile-settings-ssh-keys = profile settings → SSH Keys
click-app-will-remember-key = Click <0>"{ $a1 }"</0> — the app will remember the key for { $a2 }.
this-server = this server

## src/components/BranchPicker.tsx

find-branch-or-enter-new = Find a branch or enter a new name…
in-progress-switching-branches-is = { $a0 }{ $a1 } in progress — switching branches is unavailable until the operation finishes or is aborted.
if-changes-conflict-with-selected = If the changes conflict with the selected branch, git will stop and ask you to commit or stash first
uncommitted-changes-will-come-with = Uncommitted changes ({ $a0 }) will come with you to the selected branch
local-2 = Local
current-branch-show-in-graph = Current branch — show in graph
ahead-of-by = Ahead of { $a0 } by { $a1 }
behind-by = Behind { $a0 } by { $a1 }
branch-was-deleted-on-remote = The branch was deleted on the remote
no-upstream-branch-is-local = No upstream — the branch is local only
remote = Remote
create-local-branch-tracking-and = Create local branch { $a0 } tracking { $a1 } and switch
create-local = create local
create-branch-from-current-head = Create branch { $a0 } from the current HEAD and switch to it
create-branch-2 = Create branch <0>{ $a1 }</0>
from-head = from HEAD
is-invalid-branch-name = "{ $a0 }" is an invalid branch name
nothing-found = Nothing found
select-switch = <0><1>↑↓</1> select</0><2><3>{ $a4 }</3>switch</2>{ $a5 }
new-branch-2 = { $a0 } New branch…
current-2 = current
show-in-graph = Show in graph

## src/components/BranchSync.tsx

update-pull = Update { $a0 } (Pull){ $a1 }
without-switching-2 = {" "}without switching
has-diverged-from-server-switch = { $a0 } has diverged from the server — switch to it and Pull
update-3 = Update { $a0 }
was-deleted-on-server = { $a0 } was deleted on the server
incoming-commits = Incoming commits: { $a0 }
outgoing-commits = Outgoing commits: { $a0 }
couldnt-get-commit-list = Couldn't get the commit list
will-arrive-on-pull = Will arrive on Pull
will-leave-on-push = Will leave on Push
loading-2 = { $a0 } Loading…
click-show-in-graph =
    { $a0 }
    { $a1 }
    Click — show in graph
and-more-2 = …and { $a0 } more
update-pull-2 = { $a0 } Update (Pull)
branch-has-its-own-commits = The branch has its own commits (↑{ $a0 }) — switch to it and Pull.
to-send-them-switch-to = To send them, switch to the branch and Push.
without-switching-branches = without switching branches

## src/components/ChangeRuler.tsx

change-map = Change map
change-of = Change { $a0 } of { $a1 }: +{ $a2 } −{ $a3 }

## src/components/ci/CheckView.tsx

errors = Errors
error = error
warnings = Warnings
warning = warning
tips = Tips
tip = tip
errors-2 = errors
errors-3 = errors
warnings-2 = warnings
warnings-3 = warnings
tips-2 = tips
tips-3 = tips
configuration-check-isnt-available-for = Configuration check isn't available for this file
pipeline-wont-be-created-or = { $a0 } { $a1 } — the pipeline won't be created or jobs will fail
no-obvious-errors-but-some = No obvious errors, but some things may break
check-passed-no-errors-found = Check passed — no errors found
checked-locally-without-sending-to = { $a0 } · { $a1 }, checked locally, without sending to the server{ $a2 }
no-remarks = No remarks
on-unsaved-draft = {" "}· on the unsaved draft
checked-syntax-and-keys-references = Checked: syntax and keys, references between jobs, run rules, and script commands — against the repository files and the job images.
all = All · { $a0 }
collapse-all = Collapse all
expand-all = Expand all
when = When
how-it-shows-up = How it shows up
why = Why
how-to-fix = How to fix
show-in-file = { $a0 } Show in file{ $a1 }
line = {" "}· line { $a0 }
job-on-diagram = Job "{ $a0 }" on the diagram { $a1 }
check-code = Check code
what-runs-on-different-events = { $a0 } What runs on different events
workflow-rules-rules-and-only = Workflow rules, rules and only/except are evaluated for typical events. Variable values from the project settings and the list of changed files aren't known in advance — such jobs are marked "?".
wont-be-created = { $a0 } won't be created
job-3 = job
jobs = jobs
jobs-3 = jobs
no-pipeline = { $a0 } no pipeline
depends-on-2 = {" "}· depends on: { $a0 }
pipeline-wont-be-created-gitlab = Pipeline: won't be created — GitLab will reject it with the error below
pipeline-3 = Pipeline: { $a0 } — { $a1 }
created-2 = created
not-created = not created
will-be-in-pipeline = Will be in the pipeline
wont-be-in-it = Won't be in it
depends-on-3 = {" "}· depends on { $a0 }
configuration-check-no-errors-found = { $a0 }<1>Configuration check: no errors found</1>{ $a2 }<3>Details { $a4 }</3>
check-found-errors-ci-wont = The check found errors — CI won't run or jobs will fail
check-some-things-may-break = Check: some things may break
all-problems = All problems { $a0 }
line-2 = line { $a0 }

## src/components/ci/CiEditor.tsx

live-runners-labels = Live runners' labels

## src/components/ci/CiPanel.tsx

detect-automatically = Detect automatically
pipelines-2 = Pipelines { $a0 }
ci-cd-pipelines = CI/CD pipelines
pipeline-statuses-in-graph-logs = Pipeline statuses in the graph, logs, runs, runners and secrets work with the repository sign-in — the same one as for Pull and Push. No separate sign-in needed.
couldnt-determine-where-this-repositorys = Couldn't determine where this repository's CI runs. Specify the service and, for your own server, the API address.
pipelines = Pipelines
runners = Runners
secrets-and-variables = Secrets and variables
secrets-are-visible-only-to = Secrets are visible only to repository admins
schedules = Schedules
connection = Connection
open-repository-in = Open the repository in { $a0 }
ci-cd-token-from-previous = CI/CD token from the previous version
repository-sign-in-same-as = Repository sign-in — the same as for Pull and Push
repository-sign-in-3 = · repository sign-in
view-only = · view only
ci-cd-connection-saved = CI/CD connection saved
own-server-specify-service-and = { $a0 } Own server: specify the service and API address
ci-cd-connection = CI/CD connection
service-2 = <0>Service</0>{ $a1 }
currently-2 = { $a0 } (currently: { $a1 })
base-api-url-for-your = <0>Base API URL — for your own server (GitLab Self-Managed, GitHub Enterprise, Gitea)</0>{ $a1 }<2>Empty — { $a3 }. The token comes from the repository sign-in; no need to enter it separately.</2>
by-remote-address = by the remote address
save = Save
minimize = Minimize
all-2 = All
branch-5 = branch
refresh = Refresh
no-active-branch = No active branch
no-permission-to-run = No permission to run
run-3 = Run
couldnt-refresh = Couldn't refresh: { $a0 }
branch-has-had-no-pipelines = Branch { $a0 } has had no pipelines yet
no-pipelines-yet = No pipelines yet
select-pipeline-on-left = Select a pipeline on the left
pipeline-started = Pipeline #{ $a0 } started
pipeline-started-2 = Pipeline started
artifact-downloaded = Artifact { $a0 } downloaded
loading-pipeline = { $a0 } Loading pipeline #{ $a1 }…
unavailable-2 = Unavailable
failed-jobs-of-pipeline-restarted = Failed jobs of pipeline #{ $a0 } restarted
retry-failed = Retry failed ({ $a0 })
pipeline-restarted = Pipeline #{ $a0 } restarted
retry = Retry
cancel-for-sure = Cancel for sure?
pipeline-canceled = Pipeline #{ $a0 } canceled
in-2 = In { $a0 }
pipeline = Pipeline
show-commit-in-graph = Show the commit in the graph
started-by = started by { $a0 }
coverage = coverage { $a0 }%
ci-configuration-error = { $a0 } CI configuration error
pipeline-has-no-jobs = The pipeline has no jobs
artifacts = { $a0 } Artifacts <1>{ $a2 }</1>
pipeline-saved-no-artifacts = The pipeline saved no artifacts
retention-period-expired-artifact-was = The retention period expired — the artifact was deleted
download = Download
job-started = Job { $a0 } started
job-restarted = Job { $a0 } restarted
job-canceled = Job { $a0 } canceled
starts-another-pipeline-open-in = Starts another pipeline — open in the browser
open-log = Open log
pipeline-4 = → pipeline #{ $a0 } · { $a1 }
allowed-to-fail = {" "}· allowed to fail

## src/components/ci/common.tsx

running-now = Running now
duration = Duration
b = { $a0 } B
kb = { $a0 } KB
mb = { $a0 } MB
gb = { $a0 } GB
tag-4 = tag
label-is-set-by-server = The label is set by the server itself — it can't be removed
remove = Remove { $a0 }

## src/components/ci/DagView.tsx

column-is-jobs-that-can = <0>A column is jobs that can run at the same time</0>{ $a1 }{ $a2 }
waits-for-previous-stage = { $a0 }waits for the previous stage

## src/components/ci/DraftTools.tsx

unsaved-diagram-already-shows-draft = { $a0 }<1>Unsaved: <2>{ $a3 }</2><4>the diagram already shows the draft</4></1>{ $a5 }{ $a6 }{ $a7 }{ $a8 }
check-draft-on-gitlab-server = Check the draft on the GitLab server (CI Lint)
check-in-gitlab = { $a0 } Check in GitLab
what-will-change-in-file = What will change in the file
changes-3 = { $a0 } Changes
restore-file-as-on-disk = Restore the file as on disk
discard-edits = { $a0 } Discard edits
save-ctrl-s = Save (Ctrl+S)
save-2 = { $a0 } Save
what-will-change = What will change
comparing = { $a0 } Comparing…
keep-editing = Keep editing
no-changes = No changes
gitlab-check-failed = The GitLab check failed: { $a0 }
gitlab-accepted-configuration = GitLab accepted the configuration
gitlab-found-errors = GitLab found errors
for-branch = · for branch { $a0 }
will-run = <0>Will run:</0>{ $a1 }
stage-4 = stage { $a0 }{ $a1 }
no-job-will-run-for = No job will run for this branch.
included-files-taken-into-account = Included files taken into account: { $a0 }

## src/components/ci/GitLabSchedules.tsx

loading-schedules = { $a0 } Loading schedules…
pipelines-that-gitlab-runs-by = Pipelines that GitLab runs by itself on a schedule — for example, a nightly build or a weekly dependency check.
new-schedule = New schedule
requires-token-with-api-scope = Requires a token with the "api" scope
schedule-2 = { $a0 } Schedule
no-schedules-yet = No schedules yet
next-run = next run { $a0 }
owner = owner @{ $a0 }
last-run-pipeline = Last run: pipeline #{ $a0 } — { $a1 }
run-now = Run now
scheduled-pipeline-started = Scheduled pipeline "{ $a0 }" started
take-ownership-currently-required-to = Take ownership (currently @{ $a0 }). Required to change the schedule
you-now-own-schedule = You now own the schedule
edit-2 = Edit
click-again-to-delete = Click again to delete
schedule-deleted = Schedule "{ $a0 }" deleted
open-in-gitlab = Open in GitLab
soon = soon
in-min = in { $a0 } min
in-h = in { $a0 } h
schedule-saved = Schedule saved
schedule-created = Schedule created
edit-schedule = Edit schedule
description = Description
nightly-build = Nightly build
when-to-run = When to run
n-5-fields-are-needed-minute = 5 fields are needed: minute hour day month weekday
format-accepted-gitlab-will-check = Format accepted — GitLab will check it on save
branch = Branch
time-zone = Time zone
yours = {" "}(yours)
enabled = { $a0 }Enabled
create = Create
enabled-turn-off = Enabled — turn off
disabled-turn-on = Disabled — turn on

## src/components/ci/GitLabVariables.tsx

variable-deleted = Variable { $a0 } deleted
loading-variables = { $a0 } Loading variables…
ci-cd-variables-are-visible = CI/CD variables are visible only to the project's Maintainers and Owners
variables-from-project-settings-settings = Variables from the project settings (Settings → CI/CD → Variables). The value is requested from GitLab only when you click the eye, and isn't stored anywhere.
add-variable = Add variable
variable = { $a0 } Variable
project-has-no-variables = The project has no variables
name-value-environment-flags = <0>Name</0><1>Value</1><2>Environment</2><3>Flags</3>{ $a4 }
hidden-in-gitlab-value-isnt = hidden in GitLab — the value isn't provided
hidden-in-gitlab = hidden in GitLab
empty-2 = empty
show-value = Show value
only-for-protected-branches-and = Only for protected branches and tags
masked-in-job-logs = Masked in job logs
value-cant-be-viewed-after = The value can't be viewed after saving
no-variable-expansion = No $VARIABLE expansion
passed-to-job-as-file = Passed to the job as a file path
variable-saved = Variable { $a0 } saved
variable-added = Variable { $a0 } added
variable-2 = Variable { $a0 }
new-variable = New variable
name = Name
type = Type
variable-3 = Variable
file-2 = File
value-unchanged-until-you-start = Value (unchanged until you start typing)
value-2 = Value
hidden-value-enter-new-one = hidden value — enter a new one
previous-value = •••••••• (previous value)
for-masked-one-line-at = For masked: one line, at least 8 characters, only letters, digits and @ : . ~ - _ + / =
environment = Environment
all-3 = {"*"} (all)
mask-value-in-logs = Mask the value in logs
dont-expand-variables-inside = Don't expand $VARIABLES inside
set-only-on-creation = Set only on creation
value-cant-be-viewed-later = The value can't be viewed later
name-or-environment-changed-gitlab = The name or environment changed — GitLab will create a new variable and delete the old one.
add-2 = Add

## src/components/ci/JobForm.tsx

if-previous-stages-succeed-default = If previous stages succeed (default)
manually-with-button-in-gitlab = Manually — with a button in GitLab
always-even-if-something-failed = Always, even if something failed
only-if-something-failed = Only if something failed
delayed = Delayed
dont-run = Don't run
run-4 = run
manually = manually
always = always
dont-run-2 = don't run
delayed-2 = delayed
inherited = inherited: { $a0 }
job-name = Job name
for-example-unit-tests = for example, unit-tests
stage-5 = Stage
docker-image = Docker image
commands-script-one-per-line = Commands (script) — one per line
inherited-2 =
    inherited:
    { $a0 }
environment-environment = Environment (environment)
may-fail-error-wont-stop = { $a0 }May fail — an error won't stop the pipeline
run-after-needs = Run after (needs)
in-stage-order = in stage order
right-away-without-waiting-for = right away, without waiting for stages
add-3 = + add…
in-stage-order-no-needs = — in stage order (no needs)
right-away-needs = — right away (needs: [])
runner-tags-comma-separated = Runner tags — comma-separated
run-rules-rules-first-matching = Run rules (rules) — the first matching one fires
there-are-complex-rules-here = There are complex rules here (changes, exists, variables) — edit them in the "File" tab.
ci-commit-branch-main-empty = $CI_COMMIT_BRANCH == "main" (empty — always)
delete-rule = Delete rule
rule-2 = { $a0 } rule
if-no-rule-matches-job = If no rule matches, the job doesn't run.
more-before-script-after-script = { $a0 } More: before_script, after_script, timeout
timeout = Timeout
add-job = Add job

## src/components/ci/JobLog.tsx

back-to-pipeline-esc = Back to the pipeline (Esc)
scroll-to-first-line-with = Scroll to the first line with Error / FAIL / exit code
to-first-error = To the first error ↓
search-log-f = Search the log ({ $a0 }F)
dont-wrap-lines = Don't wrap lines
wrap-lines = Wrap lines
copy-log = Copy log
to-end = To the end
open-in = Open in { $a0 }
browser = the browser
find-in-log = Find in log…
of = { $a0 } of { $a1 }
not-found-3 = not found
previous-shift-enter = Previous (Shift+Enter)
next-enter = Next (Enter)
close-search-esc = Close search (Esc)
reason = { $a0 } Reason: { $a1 }
s = { $a0 }s
loading-log = { $a0 } Loading log…
log-is-large-kb-end = The log is large ({ $a0 } KB) — the end is shown. The full log is on the server.
this-server-doesnt-provide-logs = This server doesn't provide logs via the API — open the job in the browser.
job-hasnt-run-yet-theres = The job hasn't run yet — there's no log
waiting-for-runner-output = Waiting for runner output…
log-is-empty = The log is empty
running = { $a0 } running…
s-2 = { $a0 } s

## src/components/ci/RunDialog.tsx

required = required
run-pipeline = Run pipeline · { $a0 }
reading-run-parameters-from-config = { $a0 } Reading run parameters from the config…
branch-6 = <0>{ $a1 } Branch</0>{ $a2 }{ $a3 }
no-on-workflow-dispatch = {" "}(no on: workflow_dispatch)
no-workflow-has-on-workflow = No workflow has "on: workflow_dispatch" — they can't be run manually. Add this trigger to the file and push it to the server.
pipeline-variables = Pipeline variables
inputs = Inputs
variables-from-gitlab-ci-yml-2 = Variables from .gitlab-ci.yml
custom-environment-variables-key-value = <0>Custom environment variables (KEY=VALUE)</0>{ $a1 }
value = value
remove-2 = Remove
fill-in = Fill in: { $a0 }

## src/components/ci/Runners.tsx

idle = idle
busy = busy
offline = offline
paused = paused
inactive-runners-deleted = Inactive runners deleted: { $a0 }
failed-2 = Failed: { $a0 }
loading-runners = Loading runners…
self-hosted = { $a0 } Self-hosted <1>{ $a2 }</1>
cloud = { $a0 } Cloud <1>{ $a2 }</1>
name-or-tag = Name or tag
clean-up-inactive = Clean up inactive{ $a0 }
delete-offline = Delete { $a0 } offline?
no-permission = No permission
no-offline-self-hosted-runners = No offline self-hosted runners
connect-runner = Connect runner
no-runners-available-jobs-will = No runners available — jobs will wait in the queue. Click "Connect runner".
no-self-hosted-runners-jobs = No self-hosted runners — jobs are picked up by cloud runners
open-job = Open job
unknown-os = Unknown OS
cloud-2 = cloud
shared = shared
last-online = last online { $a0 }
insert-into-config = { $a0 } Insert into config
shared-runner-is-changed-by = A shared runner is changed by the server admin
runner-saved = Runner { $a0 } saved
runner-deleted = Runner { $a0 } deleted
runner = Runner { $a0 }
delete-runner-for-sure = Delete the runner for sure?
shared-runner-is-deleted-by = A shared runner is deleted by the server admin
close = Close
providers-cloud-runner-managed-by = The provider's cloud runner — managed by the service itself.
servers-shared-runner-only-admin = The server's shared runner: only an admin can change it.
tags-labels = Tags / labels { $a0 }
gray-ones-are-system-labels = (gray ones are system labels set by GitHub)
paused-2 = Paused
active = Active
paused-runner-doesnt-take-new = A paused runner doesn't take new jobs but finishes the current ones — you can take the server down for maintenance without breaking builds
run-untagged-jobs = Run untagged jobs
locked-to-current-project = Locked to current project
description-2 = <0>Description</0>{ $a1 }
maximum-job-timeout-minutes = <0>Maximum job timeout, minutes</0>{ $a1 }
as-in-project = as in the project
local-runner-started-in-docker = Local runner { $a0 } started in Docker
in-few-seconds-it-will = In a few seconds it will appear in the list with Online status
connect-runner-2 = Connect runner · { $a0 }
new-runners-tags = New runner's tags
name-optional = <0>Name (optional)</0>{ $a1 }
run-untagged-jobs-2 = Run untagged jobs
without-tags-runner-picks-up = Without tags, the runner picks up only such jobs
get-token-and-commands = Get token and commands
runner-token = Runner token
registration-token = Registration token
valid-until = valid until { $a0 }
token-is-shown-once-dont = { $a0 } The token is shown once — don't publish it.
run-in-powershell-as-administrator = Run in PowerShell as administrator.
run-in-terminal-of-server = Run in the terminal of the server where the runner will work.
local-runner-in-docker-on = { $a0 }<1>Local runner in Docker on this computer</1>{ $a2 }
starts-runner-container-with-these = Starts a runner container with these tags and registers it in { $a0 } — to run pipelines on your own computer. You can stop it right here, in the "Runners" tab.
run-locally = Run locally
local-runners-docker = { $a0 } Local runners (Docker)
container-is-running = Container { $a0 } is running
stop-and-remove-container = Stop and remove the container
container-stopped-and-removed = Container { $a0 } stopped and removed

## src/components/ci/Secrets.tsx

secret-deleted = Secret { $a0 } deleted
loading-secrets-and-variables = Loading secrets and variables…
repository-secrets-and-variables-in = Repository secrets and variables in { $a0 }. The server doesn't show secret values — they can only be replaced. Variables are visible to everyone with access to the repository.
secrets-2 = Secrets
no-secrets = No secrets
variables = Variables
no-variables = No variables
secret-saved = Secret { $a0 } saved
delete-3 = Delete?
edit-3 = Edit { $a0 }
new-secret-or-variable = New secret or variable
name-3 = <0>Name</0>{ $a1 }
new-value-server-doesnt-show = New value (the server doesn't show the old one)
secret-value-hidden = Secret (value hidden)
secret-is-encrypted-and-not = A secret is encrypted and not shown in logs. A variable is visible in settings and logs.

## src/components/CiView.tsx

if-previous-stages-succeed = if previous stages succeed
only-if-something-failed-2 = only if something failed
diagram = Diagram
check = Check
history = History
file-changed-on-disk = The file changed on disk
was-changed-in-another-editor = { $a0 } was changed in another editor while you were editing it here. What to do?
load-from-disk-my-edits = Load from disk (my edits will be lost)
save-over-it = Save over it
couldnt-save = Couldn't save { $a0 }
saved-2 = Saved
file-will-appear-in-changes = The file will appear in the changes — you can commit it
discard-edits-2 = Discard edits?
unsaved-changes-in-will-be = Unsaved changes in { $a0 } will be lost.
no-2 = No
discard-edits-3 = Discard edits
there-are-unsaved-edits = There are unsaved edits
changes-in-arent-saved-yet = Changes in { $a0 } aren't saved yet.
close-without-saving = Close without saving
save-and-close = Save and close
also-updated = Also updated
runner-tags-inserted-into-config = Runner tags inserted into the config
created-3 = Created { $a0 }
adjust-it-for-your-project = Adjust it for your project and commit
file-is-changed-but-not = The file is changed but not committed yet — the version from disk is shown
changed-locally = changed locally
check-configuration-on-gitlab-server = Check the configuration on the GitLab server (CI Lint) — including templates and include
repository-has-no-ci-cd = The repository has no CI/CD files
open-file-in-external-editor = Open the file in an external editor
reload-from-disk = Reload from disk
reading-ci-cd-settings = { $a0 } Reading CI/CD settings…
new-job = New job
edit-4 = Edit "{ $a0 }"
errors-in-file-ci-most = Errors in the file — CI most likely won't run
things-to-note = Things to note
when-it-runs = When it runs
parameters-2 = Parameters
variables-2 = { $a0 }Variables: { $a1 }
included-files = Included files
read = read{ $a0 }
external-not-loaded = external — not loaded
pipeline-5 = <0>Pipeline</0>{ $a1 }
diagram-isnt-built-for-yet = The diagram isn't built for { $a0 } yet — open the "File" tab.
stages = Stages
execution-graph-dag = Execution graph (DAG)
hover-over-job-to-highlight = Hover over a job to highlight its dependency chain
no-jobs-found-in-file = No jobs found in the file{ $a0 }
templates-hidden-jobs = { $a0 }Templates (hidden jobs) · { $a1 }
show-in-file-2 = Show in file
used-by = used by: { $a0 }
not-used-anywhere-via-extends = not used anywhere via extends
no-jobs = no jobs
job-5 = { $a0 } job
stage-name = stage name
stage-6 = { $a0 } Stage
stage-isnt-declared-in-stages-2 = The stage isn't declared in stages
add-stage-to-stages = Add the stage to stages
fix = fix
rename-stage = Rename stage
move-earlier = Move earlier
move-later = Move later
move-or-delete-stages-jobs = Move or delete the stage's jobs first
delete-stage = Delete stage
starts-another-pipeline = starts another pipeline
external = external
may-fail = may fail
rules = rules: { $a0 }
after = after: { $a0 }
stage-7 = stage { $a0 }
edit-5 = { $a0 } Edit
job-is-defined-in-included = The job is defined in an included file — { $a0 } to change it.
open-2 = open { $a0 }
open-in-check-tab-when = Open in the "Check" tab: when, how it shows up, why and how to fix
per-rules-below = per the rules below
after-jobs-in-links = after the jobs in "Links"
automatically = automatically
if-condition-is-met = , if the condition is met
in-3 = in { $a0 }
error-wont-stop-pipeline = · an error won't stop the pipeline
first-matching-rule-fires-if = The first matching rule fires; if none matches, the job doesn't run.
where-it-runs = Where it runs
image = image
from-4 = from { $a0 }
global-settings = global settings
services-2 = services
runner-tags-2 = runner tags
links = Links
after-2 = <0>after</0>{ $a1 }
go-to-job = Go to job
no-such-job = No such job
opt = {" "}(opt.)
starts-right-away-without-waiting = {"["}] — starts right away, without waiting for stages
artifacts-from = artifacts from
dont-download = — (don't download)
inherits = inherits
starts = starts
commands = Commands
steps-2 = Steps · { $a0 }
result = Result
environment-2 = environment
artifacts-2 = artifacts
kept-for = kept for
reports = reports
cache = cache
other = Other
timeout-2 = timeout
retries = retries
final-job-configuration = { $a0 }Final job configuration{ $a1 }
with-extends-applied = {" "}(with extends applied)
no-file-2 = No file
changed-not-committed = Changed, not committed
tab-indent-ctrl-comment-ctrl = Tab — indent · Ctrl+/ — comment · Ctrl+S — save
step-template = { $a0 } Step template { $a1 }
insert-at-cursor = Insert at the cursor
ci-cd-files-have-never = CI/CD files have never been committed
commits-that-changed-ci-cd = Commits that changed the CI/CD settings. Click to show the commit in the graph.
repository-has-no-ci-cd-settings = The repository has no CI/CD settings
looking-for-files-gitlab-ci = Looking for files: <0>.gitlab-ci.yml</0>, <1>.github/workflows/*.yml</1>, <2>Jenkinsfile</2>, <3>bitbucket-pipelines.yml</3>, <4>.circleci/config.yml</4>, <5>azure-pipelines.yml</5> and others.
create-gitlab-ci-yml = { $a0 } Create .gitlab-ci.yml
create-github-actions = { $a0 } Create GitHub Actions
view-pipelines = View pipelines{ $a0 }

## src/components/CloneDialog.tsx

where-to-save-repository = Where to save the repository
clone-repository-2 = Clone repository
paste-address-and-click-check = Paste the address and click "Check"
choose-folder = Choose a folder
cancel-2 = { $a0 } Cancel
clone = { $a0 } Clone
check-2 = { $a0 }Check
https-or-ssh-address-from = The HTTPS or SSH address from the "Code" / "Clone" button on the project page. If the repository is private, a sign-in window will appear.
enter-credentials = { $a0 } Enter credentials
access-granted = <0>{ $a1 } Access granted{ $a2 }</0>{ $a3 }
repository-is-empty-it-will = The repository is empty — it will be cloned without files
default-2 = {" "}(default)
branches = branches
where = Where
choose-folder-2 = Choose a folder…
folder-name = folder-name
only-last-50-commits-faster = { $a0 }Only the last 50 commits — faster for large repositories

## src/components/CommitDetails.tsx

select-commit = Select a commit
commit-3 = { $a0 }<1>commit:</1><2>{ $a3 }</2>{ $a4 }{ $a5 }
this-is-current-commit-nothing = This is the current commit — nothing to restore
restore-files-from-commit-checkout =
    Restore files from the commit… (checkout files)
    A new commit where all project files are as in this one. History isn't rewritten, the branch isn't switched.
author = author · { $a0 }
parents = parents:
parent = parent:
vs-1st-parent = vs 1st parent
no-changed-files = No changed files
found-here = "{ $a0 }" found here: { $a1 }
found-in = { $a0 }{ $a1 }<2>"{ $a3 }" found: { $a4 } in { $a5 } { $a6 }</2>
file-5 = file
files-4 = files
open-changes-at-match =
    { $a0 }
    Open the changes at the match
added-line = Added, line { $a0 }
deleted-was-on-line = Deleted, was on line { $a0 }
and-more-3 = …and { $a0 } more { $a1 }
on-branch = on branch { $a0 }
stashed = stashed { $a0 } · { $a1 }
restore-only-selected-files-to = Restore only the selected files to the working folder. The stash stays in the list, the index doesn't change. Undo reverts it.
apply-selected = Apply selected ({ $a0 })
apply-whole-stash-apply-it = Apply the whole stash (Apply); it stays in the list. To take individual files, check them below.
apply-all = Apply all
apply-whole-stash-and-remove = Apply the whole stash and remove it from the list (Pop)
pop = Pop
delete-stash-drop-undo-can = Delete the stash (Drop) — Undo can bring it back
clear-selection = Clear selection
select-all-files = Select all files
selected-of = selected <0>{ $a1 }</0> of { $a2 }
including-new = {" "}· including new
reset = reset
check-files-to-restore-only = Check files to restore only them, or hover over a file.
select-for-restoring = Select for restoring
new = new
restore-this-file-to-working = Restore this file to the working folder (Undo reverts it)
change = change
changes-4 = changes
changes-5 = changes
in-4 = {" "}in <0>{ $a1 }</0>
conflicts-2 = <0>Conflicts <1>({ $a2 })</1></0>{ $a3 }
resolve = <0>resolve →</0>
unstaged-files = Unstaged files
stage-all = Stage all
staged-files = Staged files
unstage-all = Unstage all
pre-commit-guard-see-warning = Pre-commit Guard: { $a0 } — see the warning above the Commit button
moved-without-content-changes = Moved without content changes
moved-and-changed = Moved and changed
file-was-only-moved-or = The file was only moved or renamed — the content didn't change
binary-or-too-large-file = Binary or too large file — lines aren't counted

## src/components/CommitForm.tsx

commit-4 = Commit
commit-message-templates = Commit message templates
templates = Templates
templates-2 = { $a0 } Templates
commit-form-settings = Commit form settings
commit-type = Commit type
click-to-remove = {" "}— click to remove
scope-area-of-changes-feat = Scope — the area of changes: feat(api): …
choose-commit-type-first = Choose a commit type first
breaking-change-breaking-change-feat = Breaking change (BREAKING CHANGE): feat!: …
remove-from-message = Remove { $a0 } from the message
add-issue-number-from-branch = Add the issue number from branch { $a0 }
how-to-add-issue-number = How to add the issue number
issue-number-format = Issue number format
summary-what-was-done = Summary: what was done
commit-title = Commit title
git-recommends-keeping-title-within = Git recommends keeping the title within 50 characters, 72 at most
message-contains-skip-ci-pipeline = The message contains [skip ci] — the pipeline won't run for this commit. Click to remove
add-skip-ci-commit-wont = Add [skip ci]: the commit won't start a CI/CD pipeline (GitLab, GitHub, Gitea, Bitbucket)
skip-ci-skip-ci = { $a0 } Skip CI <1>[skip ci]</1>
stage-files-to-commit = Stage files to commit
enter-commit-message = Enter a commit message
commit-5 = Commit { $a0 } { $a1 }
scope-whats-affected = Scope — what's affected
by-staged-files-folders = By staged files' folders
remove-scope = Remove scope
issue-number = Issue number <0>{ $a1 }</0>
found-in-branch-name = Found in the branch name <0>{ $a1 }</0>
add-issue-number-automatically = { $a0 }<1>Add the issue number automatically</1>
your-own-recognition-rule-in = Your own recognition rule — in settings →
from-git-config = From git config
new-template = New template
new-2 = { $a0 } new
my-templates = My templates
empty-for-now-save-description = Empty for now — save a description as a template.
save-whats-currently-in-description = Save what's currently in the description
write-description-first = Write a description first
save-current-description-as-template = { $a0 } Save the current description as a template
ticket-and-branch-are-substituted = <0>{"{"}ticket{"}"}</0> and <1>{"{"}branch{"}"}</1> are substituted on insert
edit-template = Edit template
what-was-done-how-to =
    What was done:
    -{" "}
    {""}
    How to test:
    {""}
    Issue: {"{"}ticket{"}"}
type-bar-above-commit-title = { $a0 }<1><2>Type bar above the commit title</2>{ $a3 }</1>
chips-etc-put-prefix-at = The { $a0 } { $a1 } { $a2 } chips etc. put a prefix at the start of the title; a second click removes it. Next to them — { $a3 } with hints from staged files' folders and { $a4 } for breaking changes.
issue-number-from-branch-name = Issue number from the branch name
add-issue-number-automatically-2 = { $a0 }<1><2>Add the issue number automatically</2>{ $a3 }</1>
if-branch-name-has-number = If the branch name has a number ({ $a0 }, { $a1 }, { $a2 }), it appears in the new message right away. When off, the number is added by clicking the { $a3 } button.
where-to-put-it = Where to put it
your-own-rule-regular-expression = Your own rule — a regular expression; the number is taken from the first group. Empty — built-in recognition.
for-example-task-d-or = for example: (TASK-\d+)  or  /(\d+)-
error-in-expression-built-in = Error in the expression — built-in recognition is used
test-on-branch = <0>Test on a branch</0>{ $a1 }<2>{ $a3 }</2>
description-templates = Description templates
take-template-from-git-config = { $a0 }<1><2>Take the template from git config (commit.template)</2>{ $a3 }<4>{ $a5 }</4></1>
as-in-regular-template-text = As in regular { $a0 }: the template text prefills the description, lines with { $a1 } become a hint.
open-repository-to-see-its = Open a repository to see its template.
in-this-repository = In this repository: <0>{ $a1 }</0>
not-set-in-this-repository = Not set in this repository. To set it: { $a0 }
my-templates-inserted-with-templates = <0>My templates — inserted with the "Templates" button above the commit form</0>{ $a1 }{ $a2 }
restore-default-templates-yours-will = Restore the default templates (yours will be deleted)
default-3 = { $a0 } Default
new-3 = { $a0 } New
reset-settings-templates-stay = { $a0 } Reset settings (templates stay)

## src/components/CommitGraph.tsx

committed-at = Committed: { $a0 }
repository-has-no-commits-yet = The repository has no commits yet
drag-to-change-graph-width = Drag to change the graph width. Double-click — auto
drag-to-change-width-double = Drag to change the width. Double-click — fit content
table-view = Table view
table-view-columns-row-density = Table view: columns, row density, date format, graph nodes
showing-last-commits = Showing the last { $a0 } commits
marked-for-comparison-ctrl-click = Marked for comparison — Ctrl+click another commit
found-in-changes =
    Found in changes:
    { $a0 }{ $a1 }
pipeline-click =
    Pipeline #{ $a0 }: { $a1 }{ $a2 }
    Click — { $a3 }
log-of-failed-job = log of the failed job
details = details
click-copy =
    { $a0 }
    Click — copy
more-hover-over =
    {""}
    { $a0 } more: hover over "+{ $a1 }"
double-click-drag-onto-another =
    {""}
    Double-click — { $a0 }
    Drag onto another branch: merge, fast-forward, rebase
switch-to-branch = switch to the branch
create-local-branch-and-switch = create a local branch and switch
head-detached-current-commit-without = HEAD (detached) — the current commit without a branch
head-current-commit = HEAD — the current commit

## src/components/CompareView.tsx

root-2 = (root)
compare = { $a0 }<1>Compare</1>{ $a2 }{ $a3 }{ $a4 }{ $a5 }{ $a6 }
before-2 = before
swap = Swap
after-3 = after
file-changed = file changed
files-changed = files changed
files-changed-2 = files changed
line-added = line added
lines-added = lines added
lines-added-2 = lines added
line-deleted = line deleted
lines-deleted = lines deleted
lines-deleted-2 = lines deleted
only-in-after = Only in "after" ({ $a0 })
only-in-before = Only in "before" ({ $a0 })
where-most-changes-are = Where most changes are{ $a0 }
show-all-folders = show all folders
filter-list-by-file-path = Filter the list by file path
search-text-in-changed-lines = Search text in the changed lines of all files (Ctrl+F)
content = Content
filter-by-path = Filter by path
find-in-changed-lines-of = Find in the changed lines of all files
find-in-changes = Find in changes
match-case-alt-c = Match case (Alt+C)
regular-expression-alt-r = Regular expression (Alt+R)
by-path = by path
by-size = by size
files-in-these-commits-are = The files in these commits are identical
binary = binary
from-before-to-after = { $a0 } from "before" to "after"
after-is-older-by = "after" is older by { $a0 } { $a1 }
diverged-and = diverged: { $a0 } and { $a1 } { $a2 }
enter-text-well-find-it = Enter text — we'll find it in the added and deleted lines of all compared files.{ $a0 }Clicking a line opens the file right at the match.
searching = { $a0 } Searching…
not-found-in-changed-lines = Not found in the changed lines
in-5 = { $a0 } { $a1 } in { $a2 } { $a3 }{ $a4 }
match = match
matches = matches
matches-2 = matches
first-shown = {" "}· first { $a0 } shown
collapse = collapse
more = { $a0 } more{ $a1 }

## src/components/ConflictView.tsx

mine = Mine
theirs = Theirs
saving = Saving
conflict = Conflict
file-of = { $a0 }file { $a1 } of { $a2 }{ $a3 }
previous-conflicted-file = Previous conflicted file
next-conflicted-file = Next conflicted file
resolved-of = <0>Resolved { $a1 } of { $a2 }</0>{ $a3 }{ $a4 }{ $a5 }
previous-unresolved-alt = Previous unresolved (Alt+↑)
next-unresolved-alt = Next unresolved (Alt+↓)
show-blocks = Show blocks
preview-resulting-file = Preview the resulting file
reload-file-from-disk = Reload the file from disk
save-file-and-mark-conflict = Save the file and mark the conflict resolved (Ctrl+S)
resolve-all-conflicts-in-file = Resolve all conflicts in the file first
save-and-next = Save and next
reading-conflict = { $a0 } Reading the conflict…
lines-without-conflicts-show = ⋯ { $a0 } lines without conflicts — show
conflict-of-line = <0>{ $a1 } Conflict { $a2 } of { $a3 }</0><4>line { $a5 }</4>{ $a6 }{ $a7 }{ $a8 }{ $a9 }{ $a10 }{ $a11 }
keep-both-versions-first-then = Keep both versions: first "{ $a0 }", then "{ $a1 }"
both = Both: { $a0 } + { $a1 }
remove-both-versions = Remove both versions
neither = { $a0 } Neither
reset-resolution = Reset the resolution
as-before-both-changes-common = { $a0 } As before both changes (common ancestor)
result-2 = <0>Result</0>{ $a1 }{ $a2 }{ $a3 }
order = order:{ $a0 }/{ $a1 }
edit-manually = { $a0 } Edit manually
back-to-choosing-lines = { $a0 } Back to choosing lines
choose-version-with-buttons-above = Choose a version with the buttons above or check the lines you need
block-will-be-deleted = — the block will be deleted —
empty-lines-were-deleted-on = empty — the lines were deleted on this side
all-lines = all lines ({ $a0 })
conflict-isnt-resolved-yet = ● conflict { $a0 } isn't resolved yet
block-deleted = (block deleted)
file-was-deleted-in-but = The file was deleted in "{ $a0 }" but changed in "{ $a1 }"
decide-whether-file-is-needed = { $a0 }: { $a1 }. { $a2 }: { $a3 }. Decide whether the file is needed.
keep-file-version = { $a0 } Keep the file ("{ $a1 }" version)
delete-file = { $a0 } Delete the file
binary-file-changed-on-both = Binary file changed on both sides
image-or-other-binary-file = An image or other binary file can't be merged line by line — choose one version entirely.
take = { $a0 } Take "{ $a1 }" ({ $a2 })
take-2 = Take "{ $a0 }" ({ $a1 }) { $a2 }
file-was-deleted-on-both = The file was deleted on both sides
it-remains-to-confirm-deletion = It remains to confirm the deletion.
there-are-no-conflict-markers = There are no conflict markers in the file
file-isnt-on-disk = The file isn't on disk
it-looks-like-youve-already = It looks like you've already fixed the file (for example, in an editor). Check it and mark it resolved.
mark-conflict-resolved-file-will = Mark the conflict resolved — the file will be removed from the repository.
mark-resolved = { $a0 } Mark resolved
take-entirely = Take "{ $a0 }" entirely
conflict-in-this-file-is = The conflict in this file is already resolved
open-file-in-editor = { $a0 } Open the file in the editor
take-in-all-conflicts-of = Take "{ $a0 }" in all conflicts of this file
take-everywhere = Take "{ $a0 }" everywhere

## src/components/Dialogs.tsx

gits-response = { $a0 } Git's response
authorization-required = Authorization required
no-write-access = No write access
branch-is-protected = The branch is protected
push-rejected-by-server = Push rejected by the server
repository-is-unavailable = The repository is unavailable
ssh-unknown-server = SSH: unknown server
check-access = { $a0 } Check access
got-it = Got it
yes = yes
no = no
not-checked = not checked
remote-access = Remote access
enter-credentials-2 = Enter credentials
enter-credentials-change-token = Enter credentials / Change token
checking-2 = Checking…
check-again = Check again
branch-7 = <0>Branch</0><1>{ $a2 } → { $a3 }</1>
read-fetch = Read (fetch)
write-push = Write (push)
branch-on-remote = Branch on remote
will-be-created-on-first = — will be created on the first Push
remote-has-commits-you-dont = { $a0 }The remote has commits you don't have: Pull is needed before Push.
permissions-are-checked-safely-git = Permissions are checked safely: <0>git ls-remote</0> and <1>git push --dry-run</1> change nothing on the server. The server applies branch protection rules (protected branches) only on a real push — if the branch is protected, you'll be told after the attempt.
checking-access = { $a0 } Checking access…
access-hasnt-been-checked-yet = Access hasn't been checked yet
push-rejected = Push rejected
yes-overwrite = Yes, overwrite { $a0 }/{ $a1 }
pull-rebase-and-push = Pull (rebase) and Push
has-commits-in-branch-that = <0>{ $a1 }</0> has commits in branch <2>{ $a3 }</2> that you don't have. A regular push would overwrite them, so the server won't accept it.
recommended-get-changes-with-pull = Recommended: get the changes with Pull (rebase), then push your commits.
force-push-with-force-with = Force Push (with <0>--force-with-lease</0>) will remove other people's commits you don't have from the remote. The server still won't allow overwriting protected branches.
confirm = Confirm
delete-branch-from-server = Delete branch from server
deleting-on-server = Deleting on the server…
delete-from-server-4 = Delete from server
branch-will-be-deleted-on = Branch <0>{ $a1 }</0> will be deleted on server <2>{ $a3 }</2> (<4>git push { $a5 } --delete { $a6 }</4>).
nobody-working-with-repository-will = Nobody working with the repository will see it anymore. Open merge requests from this branch will close or become unavailable.
local-branch-stays-with-you = Local branch { $a0 } stays with you — you can push it again.
you-have-no-local-copy = You have no local copy of this branch.
undo-will-publish-branch-back = Undo ({ $a0 }) will publish the branch back at the same commit.
app-is-busy-with-another = The app is busy with another operation — retry in a second
new-tag = New tag
create-tag = { $a0 } Create tag
on-commit = On commit <0>{ $a1 }</0>
annotated-tag-with-message = { $a0 }Annotated tag (with a message)
tag-message = Tag message
new-functionality = new functionality
fix-before-release = a fix before the release
release-preparation = release preparation
urgent-fix-in-production-version = an urgent fix in the production version
support-of-old-version = support of an old version
new-branch-3 = New branch
create-branch-3 = { $a0 } Create branch
branch-type-git-flow = Branch type (git flow){ $a0 }
prefixes-from-repositorys-git-flow = · prefixes from the repository's git flow settings
by-git-flow-its-created =
    { $a0 }… — { $a1 }
    By git flow it's created from { $a2 }
no-prefix = no prefix
branch-name = Branch name
branch-will-be-created = Branch <0>{ $a1 }</0> will be created
from-5 = From { $a0 } <1>{ $a2 }</1>{ $a3 }
branch-8 = branch
go-back-to-selected-commit = go back to the selected commit
by-git-flow-branches-are = By git flow, <0>{ $a1 }</0> branches are created from <2>{ $a3 }</2>.{ $a4 }{ $a5 }{ $a6 }
theres-no-such-branch-in = {" "}There's no such branch in the repository — the branch will be created from the selected commit.
create-from = { $a0 } Create from { $a1 }
switch-to-new-branch = { $a0 }Switch to the new branch
commit-isnt-on-branch = Commit { $a0 } isn't on a branch
switch-head-detached = { $a0 } Switch HEAD (Detached)
create-branch-here-2 = { $a0 } Create a branch here…
theres-no-branch-on-this = There's no branch on this commit. If you switch HEAD right to the commit, you'll be in the <0>detached HEAD</0> state: new commits won't get into any branch. It's easier to create a branch here first.
there-are-several-branches-on = There are several branches on the commit — which one to switch to?
local-3 = { $a0 }<1>{ $a2 }</1><3>local</3>
create-local-and-track = { $a0 }<1>{ $a2 }</1><3>create local and track</3>
rename-branch = Rename branch { $a0 }
rename-4 = { $a0 } Rename
new-branch-name = New branch name
only-local-branch-changes-git = Only the local branch changes (<0>git branch -m</0>); Undo brings back the old name.{ $a1 }
branch-on-server-keeps-its = {" "}The branch on server <0>{ $a1 }</0> keeps its old name, and the local one keeps tracking it.
stash-and-switch = Stash and switch
changes-go-to-stash-you = The changes go to a stash — you can get them from the Stash list.
changes-will-be-stashed-as = The changes will be stashed as { $a0 } and come back by themselves when you switch back to { $a1 }.
resolve-conflicts-in-files-marked = Resolve the conflicts in files marked U first
bring-changes-to = Bring the changes to { $a0 }
and-in-conflict-is-possible = { $a0 } { $a1 } and in { $a2 } — a conflict is possible. If it happens, a copy of the changes stays in Stash.
changes-will-come-with-you = The changes will come with you: in { $a0 } they don't overlap with other edits.
discard-changes-and-switch = Discard changes and switch
working-folder-will-be-as = The working folder will be as in the branch's commit. Ctrl+Z brings back both the branch and the discarded changes.
remember-choice-for-future-switches = Remember the choice for future switches. Change it in Settings → Branches
dont-ask-again = { $a0 }Don't ask again
bring-and-switch = Bring and switch
discard-and-switch = Discard and switch
has-uncommitted-changes-what-to = <0>{ $a1 }</0> has uncommitted changes: { $a2 } { $a3 }{ $a4 }. What to do with them?
new-among-them = , new among them: { $a0 }
changed-in-too = Changed in { $a0 } too
also-in = also in { $a0 }
and-more-4 = … and { $a0 } more
recommended-2 = recommended

## src/components/DiffView.tsx

commit-6 = commit { $a0 }
new-file = new file
ignore-whitespace-changes = Ignore whitespace changes
showing-whole-file-click-to = Showing the whole file. Click to show only the changed places
show-whole-file-not-only = Show the whole file, not only the changed places
highlight-what-exactly-changed-within = Highlight what exactly changed within a line
syntax-highlighting = Syntax highlighting: { $a0 }
syntax-highlighting-file-type-not = Syntax highlighting — file type not recognized
search-in-changes-ctrl-f = Search in changes (Ctrl+F)
editor-has-unsaved-edits-of = The editor has unsaved edits of this file — open them
edit-file-in-working-folder = Edit the file in the working folder (Ctrl+S to save)
edit-6 = Edit
previous-change-shift-f7 = Previous change (Shift+F7)
change-blocks-in-file = Change blocks in the file
chg = { $a0 } chg.
next-change-f7 = Next change (F7)
ln-col = Ln { $a0 }, Col { $a1 }
file-has-both-crlf-and = The file has both CRLF and LF: on save all lines will get { $a0 }
mixed-line-endings = Mixed line endings
changes-view-closed-before-edits = The changes view closed before the edits were saved: they are back. "Close editor" without saving discards them.
edits-restored = Edits restored
not-saved = Not saved
back-to-changes-view-esc = Back to the changes view (Esc)
close-editor = Close editor
previous-file-alt = Previous file (Alt+↑)
next-file-alt = Next file (Alt+↓)
reload-2 = Reload
opening-file = { $a0 } Opening the file…
loading-diff = { $a0 } Loading diff…
binary-file-line-diff-unavailable = { $a0 } Binary file — line diff unavailable
file-is-too-large-kb-to = The file is too large ({ $a0 } KB) to view
only-line-endings-changed-crlf = Only line endings changed (CRLF ↔ LF) — the file text is the same
file-was-renamed-without-content = The file was renamed without content changes
whitespace-only-changes = Whitespace-only changes
no-content-changes = No content changes
diff-is-too-large-only = The diff is too large — only some lines are shown
unsaved-edits = Unsaved edits
editor-has-unsaved-edits-they = The editor has unsaved edits. They will be lost if you close it.
whitespace-changed = Whitespace changed
only-in-changed-lines-and = Only in changed lines (+ and −)
of-2 = { $a0 } of { $a1 }{ $a2 }
no-matches = No matches
previous-shift-enter-shift-f3 = Previous (Shift+Enter, Shift+F3)
next-enter-f3 = Next (Enter, F3)

## src/components/FileView.tsx

reading-file-history = { $a0 } Reading the file history…
file-has-no-history-yet = The file has no history yet: it isn't committed{ $a0 }.
in-this-version = {" "}in this version
with-renames = with renames
up-to = up to { $a0 }
ctrl-click-second-version-to = Ctrl+click — second version to compare
file-created = file created
file-deleted = file deleted
renamed-from = renamed from { $a0 }
copied-from = copied from { $a0 }
remove-from-comparison = Remove from comparison
compare-this-version-with-selected = Compare this version with the selected one
version-comparison-b = { $a0 }Version comparison: <1>A { $a2 }</1> → <3>B { $a4 }</3><5>({ $a6 } → { $a7 })</5>{ $a8 }
normal-mode = Normal mode
restore-version-b = Restore version B
restore-file-to-this-version = Restore the file to this version
file-in-working-folder-will-become-as = File { $a0 } in the working folder will become as in commit { $a1 }{ $a2 }. No commit is created; Undo reverts it.
it-was-called-then = {" "}(it was called { $a0 } then)
blame-this-version = Blame this version
who-changed-lines-and-when = Who changed the lines and when — in version { $a0 }
commit-isnt-in-graphs-loaded = Commit { $a0 } isn't in the graph's loaded history
its-older-than-loaded-commits = It's older than the loaded commits or in another branch — Fetch or load more history
working-folder-with-uncommitted-lines = working folder (with uncommitted lines)
version-2 = version { $a0 }
blame-old-recent = { $a0 }<1>Blame: <2>{ $a3 }</2>{ $a4 }</1>{ $a5 }{ $a6 }{ $a7 }{ $a8 }<9>old{ $a10 }recent</9>{ $a11 }{ $a12 }
back-to-previous-blame-esc = Back to the previous blame (Esc)
back = { $a0 } Back
file-was-called-then = { $a0 } · the file was called { $a1 } then
file-was-called-then-2 = {" "}· the file was called { $a0 } then
depth = · depth { $a0 }
to-head = to HEAD
with-uncommitted-changes = With uncommitted changes
working-folder = working folder
heat-map-more-recent-change = Heat map: the more recent the change, the brighter the bar
ignore-whitespace-git-blame-w = Ignore whitespace (git blame -w): indentation-only edits don't count as line changes
ignore-whitespace = { $a0 } Ignore whitespace
computing-line-authorship = { $a0 } Computing line authorship…
file-is-empty = The file is empty
not-committed = Not committed
age = Age: { $a0 }
blame-before-this-commit = Blame before this commit ({ $a0 })
lines-appeared-together-with-file = The lines appeared together with the file — they didn't exist before
statistics = { $a0 } statistics…
files-lines-in-blame = <0>files: <1>{ $a2 }</1></0><3><4>+{ $a5 }</4> <6>−{ $a7 }</6></3>{ $a8 }<9>lines in blame: { $a10 }</9>
in-this-file = in this file: <0>+{ $a1 }</0> <2>−{ $a3 }</2>
blame-before-this-commit-2 = Blame before this commit
changes-in-file-history = Changes in the file history
file-is-too-large-first = The file is too large — the first { $a0 } lines are shown

## src/components/GraphViewMenu.tsx

commit-table-view = Commit table view
columns = Columns
message-is-always-visible-and = The message is always visible and takes the space of hidden columns
order-drag-column-header = { $a0 }Order — drag a column header
row-density = Row density
date-and-time = Date and time
graph-nodes = Graph nodes
reset-column-widths-and-view = { $a0 }Reset column widths and view

## src/components/Guard.tsx

pre-commit-check-is-off = The pre-commit check is off
turn-on = turn on
configure = configure
checked-nothing-suspicious = { $a0 }<1>Checked: nothing suspicious</1>{ $a2 }
added-lines-were-checked-no = The added lines were checked: no forgotten debug code or secret-like strings
show-what-was-found = Show what was found
commit-is-forbidden-by-check = The commit is forbidden by the check rules
in-commit = { $a0 } { $a1 } in the commit
suspicious-spot = suspicious spot
suspicious-spots = suspicious spots
suspicious-spots-2 = suspicious spots
turn-off-check-for-this = Turn off the check for this repository
configure-rules = Configure rules
commit-forbidden = Commit forbidden
check-before-committing = Check before committing
pre-commit-check = Pre-commit check
added-lines-contain-line-can = { $a0 }The added lines contain { $a1 } { $a2 }{ $a3 }. A line can be marked with a <4>gorynych-ignore</4> comment so the check skips it.
rules-with-forbid-level-fix = { $a0 }<1>{ $a2 } { $a3 } rules with the "Forbid" level — fix the lines or change the rule level in the settings.</1>
finding-violates = finding violates
findings-violate = findings violate
findings-violate-2 = findings violate
of-them-look-like-secrets = , of them <0>{ $a1 } look like secrets</0> — keys and tokens stay in Git history forever, even if you delete the file later
open-files-changes = Open the file's changes
only-first-findings-are-shown = Only the first findings are shown — there are too many
configure-rules-2 = { $a0 } Configure rules…
go-back-and-fix = Go back and fix
commit-anyway = Commit anyway
check-before-committing-2 = Check before committing
before-each-commit-app-looks = Before each commit the app looks at the added lines and warns about forgotten debug code and secret-like strings.
hint-while-preparing-commit = Hint while preparing a commit
banner-above-commit-button-badges = A banner above the Commit button, badges on files and line marks in the diff — even before clicking Commit.
check-in-this-repository = Check in this repository
for-each-rule-off-dont = For each rule: <0>Off</0> — don't check, <1>Warn</1> — show and ask, <2>Forbid</2> — the commit isn't created until the line is fixed or marked <3>gorynych-ignore</3>.
add-4 = { $a0 } Add
for-example-forbid-fit-in = For example, forbid "fit(" in tests or internal server addresses. A rule is a regular expression.
repositories-without-check = Repositories without the check
restore-all-defaults = { $a0 } Restore all defaults
all-4 = { $a0 }<1>all:</1>{ $a2 }
only-in-these-files = Only in these files
dont-check-files = Don't check files
path-patterns-md-by-name = Path patterns: <0>*.md</0> — by name in any folder, <1>docs/**</1> — a whole folder, <2>**/*.test.*</2> — tests anywhere.
for-example-internal-address = For example: internal address
debug = Debug
secret-hide-text = Secret (hide the text)
other-2 = Other
regular-expression = Regular expression
flags = Flags
error-in-expression = Error in the expression: { $a0 }
only-in-files-comma-separated = Only in files (comma-separated extensions, empty — all)
test-on-line = Test on a line
paste-line-of-code = Paste a line of code
will-fire = <0>{ $a1 } will fire:</0>{ $a2 }<3>{ $a4 }</3>{ $a5 }
wont-fire-on-this-line = won't fire on this line
save-rule = Save rule

## src/components/GuideDialog.tsx

repositories = Repositories
clone-2 = Clone
create-repository-2 = Create repository
next-previous-tab = Next / previous tab
new-tab-open-clone-create = New tab: open, clone, create, recent
work = Work
undo-redo-action = Undo / redo an action
commit-search-in-open-diff = Commit search (in an open diff — search in changes, in comparison — by content)
filter-branches-and-tags-on = Filter branches and tags on the left
switch-branch-2 = Switch branch
commit-in-message-field = Commit (in the message field)
click-feat-fix-chip = Click a feat / fix / … chip
conventional-commits-prefix-second-click = Conventional Commits prefix; a second click removes it
double-click-commit = Double-click a commit
switch-to-its-branch-without = Switch to its branch; without a branch, it asks
double-click-branch-label = Double-click a branch label
switch-to-exactly-that-branch = Switch to exactly that branch
right-click-commit = Right-click a commit
action-menu = Action menu
ctrl-click-commit = Ctrl+click a commit
compare-with-selected-one = Compare with the selected one
drag-commit-or-branch-onto = Drag a commit or branch onto a branch
merge-cherry-pick-fast-forward = Merge, cherry-pick, fast-forward or rebase
hover-over-n-next-to = Hover over "+N" next to branches
all-branches-and-tags-of = All branches and tags of the commit
hover-over-next-to-branch = Hover over ↓ / ↑ next to a branch on the left
incoming-outgoing-commits-update-branch = Incoming / outgoing commits, update the branch
custom-shortcuts = Custom shortcuts
running-actions-from-builder-actions = Running actions from the builder (Actions menu)
right-click-file = Right-click a file
restore-file-discard-edits = Restore the file / discard edits
viewing-changes = Viewing changes
search-in-files-changes = Search in the file's changes
next-previous-match = Next / previous match
search-match-case-regular-expression = Search: match case / regular expression
next-previous-change = Next / previous change
previous-next-file = Previous / next file
interactive-rebase = Interactive rebase
select-commit-2 = Select a commit
move-commit = Move a commit
pick-reword-squash-fixup-drop = Pick / reword / squash / fixup / drop
conflicts-3 = Conflicts
save-resolution-and-move-on = Save the resolution and move on
to-previous-next-conflict = To the previous / next conflict
save-ci-file = Save the CI file
comment-out-line = Comment out a line
indent = Indent
window = Window
settings-and-appearance = Settings and appearance
developer-tools = Developer tools
getting-started = Getting started
open-create-clone-connect-tabs = open create clone connect tabs repository folder gitlab github start
git-gorynych-is-app-for = <0>git-Горыныч</0> is an app for working with Git repositories: history as a graph, commits, branches, syncing with the server, safe undo of any action and GitLab CI/CD.
open-project = Open a project
open-repository-ctrl-o-choose = <0>Open repository</0> <1>Ctrl+O</1> — choose a folder that already has Git.
clone-ctrl-shift-o-paste = <0>Clone</0> <1>Ctrl+Shift+O</1> — paste a repository link (GitLab, GitHub, etc.). The app checks access, shows the branches and suggests a folder.
create-repository-ctrl-n-make = <0>Create repository</0> <1>Ctrl+N</1> — make a Git repository from a regular folder, with a first commit and .gitignore.
connect-folder-to-gitlab-github-you = <0>Connect a folder to GitLab / GitHub</0> — you have files and an empty (or not empty) repository on the server: the app links them and pushes the changes.
all-of-this-is-on = All of this is on the start screen and in the <0>File</0> menu.
tabs = Tabs
each-repository-opens-in-its = Each repository opens in its own tab at the top. <0>Ctrl+Tab</0> — next tab, <1>Ctrl+W</1> — close. Open tabs are remembered and restored on the next launch.
almost-any-action-can-be = Almost any action can be undone: <0>Ctrl+Z</0> or the <1>Undo</1> button on the top toolbar. More in the "Undo and safety" section.
how-window-is-laid-out = How the window is laid out
interface-panel-graph-left-right = interface panel graph left right toolbar status branches remote stash tags columns header table density sha date nodes dots avatars explorer finder terminal command line folder path
top-toolbar = Top toolbar
on-left-current-repository-and = On the left — the current <0>repository</0> and <1>branch</1> (click the branch for quick switching, <2>Ctrl+B</2>).
undo-redo-pull-arrow-next = The <0>Undo / Redo</0>, <1>Pull</1> (the arrow next to it picks the mode), <2>Push</2>, <3>Branch</3> (new branch), <4>Stash / Pop</4> buttons.
on-right-server-access-status = On the right — server access status, commit search, refresh and settings.
each-repository-is-separate-tab = Each repository is a separate tab at the top. <0>"+"</0> (or <1>Ctrl+T</1>) opens a <2>New tab</2>: "Open", "Clone", "Create" buttons and a list of recent repositories — a click opens the repository right in this tab, and if it's already open, the app switches to it. The cross on a row removes it from the list (the repository itself isn't touched).
on-left-branches-and-everything = On the left — branches and everything else
local-your-branches-on-server = The <0>Local</0> (your branches), <1>On server</1> (remote branches), <2>Stash</2>, <3>Tags</3> and <4>CI/CD</4> sections. Double-click a branch to switch to it; a remote branch — to create a local copy and switch. Right-click — all branch actions. The filter field at the top (<5>Ctrl+Alt+F</5>) searches by name.
in-center-commit-graph = In the center — the commit graph
each-row-is-commit-branches = Each row is a commit: branches and tags on the left, graph lines, message, author, date. The topmost row <0>// WIP</0> is your uncommitted changes. Click — show the commit on the right, double-click — switch to its branch, right-click — action menu. A commit row or a branch label can be dragged onto another branch — see the "Drag and drop" section.
commit-table-settings = Commit table settings
right-click-table-header-or = <0>Right-click the table header</0> or the icon in its right corner — the view menu: which columns to show (including <1>SHA</1> — the short hash; a click copies the full one), row density (<2>compact 26px</2>, <3>standard 34px</3>, <4>roomy 42px</4>), <5>absolute</5> or <6>relative</6> date ("15 min ago", the exact one in the tooltip), graph nodes — <7>avatars</7> or <8>dots</8>.
columns-are-reordered-by-dragging = Columns are reordered by <0>dragging the header</0>. "Commit message" is always visible and takes the space of hidden columns.
columns-width-is-dragged-by = A column's width is dragged by the separator in the header; <0>double-clicking the separator</0> fits the width to the content (for the graph — auto). "Reset column widths and view" in the same menu restores everything.
conventional-commits-prefixes-feat-fix = Conventional Commits prefixes (<0>feat:</0>, <1>fix:</1>, <2>docs:</2>…) are shown as a colored badge. If the message doesn't fit, hover over it: the full title with the description pops up.
on-right-details = On the right — details
for-commit-message-author-parents = For a commit — the message, author, parents and the list of changed files (click a file to open the diff). For the WIP row — the "Unstaged files" / "Staged files" lists and the commit form.
at-bottom-status-bar = At the bottom — the status bar
current-branch-and-how-far = The current branch and how far ahead/behind the server it is, HEAD, the <0>auto</0> switch (background server check; right-click — settings) and the fetch button. On the right — the repository path: a click opens the folder in { $a1 }, the buttons next to it open the folder and a terminal (command line) right in this folder. The same is in the "File" menu and on right-click on the repository name.
panel-borders-can-be-dragged = Panel borders can be dragged with the mouse; double-clicking a border restores the original width.
changes-and-commits = Changes and commits
stage-unstage-commit-wip-hunk = stage unstage commit wip hunk fragment message statistics lines rename move moved
select-wip-row-in-graph = Select the <0>// WIP</0> row in the graph — the changed files appear on the right.
click-file-to-see-changes = Click a file to see the changes. Add what you need to the commit: the <0>+</0> button on the file, a double-click on the file, or <1>Stage all</1>.
you-can-add-only-part = You can add <0>only part of a file</0>: in the diff, each hunk has a <1>Stage</1> button.
write-commit-title-and-description = Write the commit title (and a description if you like) and click <0>Commit</0> or press <1>Ctrl+Enter</1>. Commit type, issue number and description templates — see the "Commit message" section.
on-right-of-each-file = On the right of each file — how many lines were added and deleted (<0>+12</0> <1>-3</1>), for binary files — <2>bin</2>. A moved or renamed file is marked <3>R</3> and shown as "old path → new path"; if the content didn't change, there's a <4>moved</4> label next to it. If you unstage such a file, both paths go at once.
made-mistake-ctrl-z-undoes = Made a mistake — <0>Ctrl+Z</0> undoes the commit and the changes are back among the staged files. If the commit is already pushed to the server, Undo won't touch it (otherwise shared history would be rewritten) — use <1>Revert commit changes (Revert)</1> from the commit menu.
commit-message-2 = Commit message
conventional-commits-feat-fix-refactor = conventional commits feat fix refactor chore docs style test perf scope prefix type issue number ticket jira issue branch template commit.template gitmessage description refs breaking
commit-type-in-one-click = Commit type in one click
above-commit-title-there-are = Above the commit title there are chips <0>feat</0>, <1>fix</1>, <2>refactor</2>, <3>chore</3>, <4>docs</4>, <5>style</5>, <6>test</6>, <7>perf</7> (the Conventional Commits format). A click puts the <8>feat: </8> prefix at the start of the message, a click on another chip changes the type, a second click removes it. If you type a prefix by hand, the matching chip lights up by itself.
scope-area-of-changes-feat-api = <0>(scope)</0> — the area of changes: <1>feat(api): …</1>. You can enter your own or pick from the hints — these are the folders containing staged files.
breaking-change-feat = <0>!</0> — a breaking change: <1>feat!: …</1>.
on-right-of-field-title = On the right of the field — the title length: yellow after 50 characters, red after 72.
if-branch-is-named-for = If a branch is named, for example, <0>feature/PROJ-123-login</0>, <1>bugfix/1234-fix</1> or <2>issue-42</2>, a { $a3 } <4>+ [PROJ-123]</4> (or <5>#1234</5>) button appears next to the chips. A click adds the number to the message, another click removes it. By default the number is added to every new message automatically.
arrow-next-to-button-where = The arrow next to the button — where to put the number:
proj-123-feat-at-start = <0>[PROJ-123] feat: …</0> — at the start (default);
feat-proj-123-instead-of = <0>feat(PROJ-123): …</0> — instead of the scope (until a type is chosen — in parentheses at the start);
feat-proj-123-at-end = <0>feat: … (PROJ-123)</0> — at the end;
refs-proj-123-on-separate = <0>Refs: PROJ-123</0> — on a separate line at the end of the description.
theres-also-add-issue-number = There's also the <0>Add the issue number automatically</0> switch. If the numbers in your branches look different, set your own rule (a regular expression) in <1>Settings → Commit message</1> and test it on a branch name right there.
templates-button-above-commit-form = The { $a0 } <1>Templates</1> button above the commit form — ready-made blanks for the description: "What was done / How to test", "Bug fix", "Breaking change". A click inserts the template and puts the cursor where you start writing; <2>{"{"}ticket{"}"}</2> and <3>{"{"}branch{"}"}</3> are replaced with the issue number and the branch name.
save-current-description-as-template-2 = <0>Save the current description as a template</0> — turns what you wrote into a template (the issue number becomes <1>{"{"}ticket{"}"}</1> by itself).
edit-or-delete-template-buttons = Edit or delete a template — buttons on hover. The full list is in the settings.
if-repository-has-git-config = If the repository has <0>git config commit.template</0> set, its text fills the description by itself, and lines with <1>#</1> are shown as a hint in the empty field — as in regular <2>git commit</2>.
typed-message-isnt-lost-if = A typed message isn't lost if you look at another commit and come back to the WIP row. After a commit the form is filled again with the issue number and the template.
branches-2 = Branches
branch-git-flow-gitflow-feature = branch git flow gitflow feature bugfix release hotfix support prefix checkout merge delete switch create detached tag server remote origin cloud laptop +N delete from server push --delete incoming outgoing ahead behind gone update without switching stash move discard changes wip uncommitted
create-and-switch = Create and switch
branch-on-toolbar-new-branch = <0>Branch</0> on the toolbar — a new branch from the current commit (or from the one selected in the graph).
right-click-commit-create-branch = Right-click a commit → <0>Create a branch here…</0> — a branch from any commit.
in-new-branch-window-you = In the new branch window you choose a <0>git flow type</0>: <1>feature/</1>, <2>bugfix/</2>, <3>release/</3>, <4>hotfix/</4>, <5>support/</5> or no prefix — the prefix is filled in by itself, you enter only the rest of the name. The app hints which branch this type is created from by git flow (feature — from develop, hotfix — from main) and offers <6>Create from develop</6>. If <7>git flow init</7> was run in the repository, the prefixes are taken from its settings. The last chosen type is remembered.
to-switch-double-click-branch = To switch: double-click a branch on the left or its label in the graph, click the branch name at the top, or press <0>Ctrl+B</0>.
double-clicking-commit-works-as = <0>Double-clicking a commit</0> works as in GitKraken: if the commit has one of your branches, it switches to it; only a server branch — it creates a local one that tracks it; several branches — it asks which one. If there are no branches, the app offers to <1>Create a branch here</1> or deliberately go to <2>detached HEAD</2> — you can't end up there by accident anymore.
merge-and-delete = Merge and delete
right-click-branch-label-in = <0>Right-click a branch label</0> (in the graph or in the list on the left) — the menu of just that branch: switch, <1>Merge … into …</1>(Merge), <2>Rebase … onto …</2> (Rebase, with preview), <3>Reset … to …</3> (Reset), <4>Rename…</4>,<5>Delete branch…</5> and <6>Delete … from server…</6>. A branch and its server copy on the same commit share one menu, without duplicates. <7>Ctrl+Z</7> brings back a deleted or renamed branch.
right-click-commit-row-commit = Right-click a commit row — the commit menu; the branches on it are gathered in the <0>Branch … ›</0> submenu. The English Git term (Merge, Rebase, Cherry-pick…) is on the right of the menu row. Clicking the hash in the menu header copies it.
faster-with-mouse-drag-branch = Faster with the mouse: drag a branch or commit onto the branch you want to merge into (the "Drag and drop" section). No need to switch in advance.
where-branch-is-on-your = Where the branch is: on your side or on the server
branch-is-only-on-your = { $a0 } — the branch is only on your side (not pushed to the server).
branch-on-server-origin-in = { $a0 } — a branch on the server (origin/…); in the graph such labels have a dashed border.
local-and-server-branches-are = <0>{ $a1 }{ $a2 }</0> — the local and server branches are on the same commit, i.e. in sync.
if-commit-has-several-branches = If a commit has several branches and tags, the graph shows the first one and a <0>+N</0> badge. Hover over it — a list of all branches and tags of the commit opens, marked "yours / on server". In the list: double-click — checkout, right-click — branch menu, hover buttons — checkout and delete from server.
incoming-and-outgoing-commits = Incoming and outgoing commits
each-local-branch-in-local = Each local branch in the Local section shows how it differs from its branch on the server:
n-3-server-has-3 = <0>↓3</0> — the server has 3 new commits; they'll arrive on Pull;
n-2-2-of-your = <0>↑2</0> — 2 of your commits aren't pushed yet (they'll leave on Push);
gone-branch-on-server-was = <0>gone</0> — the branch on the server was deleted.
hover-over-or-list-of = Hover over ↓ or ↑ — a list of these commits opens (click a commit to show it in the graph). To get the new commits, click <0>Update (Pull)</0> in this list, the arrow button when hovering over the branch, or the item in the right-click menu. If the branch isn't current and has no commits of its own, it's updated <1>without switching</1> — the working folder isn't touched. <2>Ctrl+Z</2> moves the branch back to where it was.
delete-branch-on-server = Delete a branch on the server
right-click-remote-branch-on = Right-click a remote branch (on the left, in the graph or in the "+N" list) → <0>Delete … from server…</0>, or the crossed-out cloud button when hovering over a branch in the Remote section. The app asks for confirmation: the branch disappears for everyone working with the repository. While the request to the server is running, a spinner turns on the button. The local branch stays, and <1>Ctrl+Z</1> publishes the deleted branch back at the same commit. The server won't let you delete a protected or main branch — the app explains what to do.
branch-folders = Branch folders
branches-with-in-name-are = Branches with "/" in the name are grouped into folders: feature/create-task and feature/docker — in the <0>feature</0> folder. Folders collapse with a click, and the state is remembered. The button on the right of the filter field switches between "folders / list" views.
switching-with-uncommitted-changes = Switching with uncommitted changes
if-working-folder-has-edits = If the working folder has edits, switching branches opens a window with a choice. It shows which files are changed and which of them are also changed in the target branch (a conflict is possible there).
stash-and-switch-stash-edits = <0>Stash and switch</0> (Stash) — the edits are stashed under the current branch's name and come back by themselves when you switch back, together with the staged ones. A branch with stashed edits waiting is marked with a box icon.
move-changes-edits-go-with = <0>Move changes</0> — the edits go with you to the new branch. If they overlap with the branch's edits, there'll be a conflict, and a copy stays in Stash.
discard-changes-discard-folder-becomes = <0>Discard changes</0> (Discard) — the folder becomes as in the branch's commit; <1>Ctrl+Z</1> brings back both the branch and the edits.
app-suggests-whats-better-move = The app suggests what's better: move if there are no overlaps, or stash if there are. "Don't ask again" remembers the choice; change it in <0>Settings → Branches</0>. On switching, a remote branch becomes a local branch with the same name that tracks the server. After switching, the graph smoothly scrolls to the new HEAD. <1>Ctrl+Z</1> switches back.
if-you-switch-to-commit = If you switch to a commit rather than a branch, the app warns in the status bar: new commits won't get into any branch. To go back — <0>Ctrl+Z</0> or double-click the branch you need.
tags-2 = Tags
right-click-commit-create-tag = Right-click a commit → <0>Create a tag here…</0>. You can add a description — then it'll be an annotated tag.
drag-and-drop = Drag and drop
drag-drop-mouse-merge-cherry = drag drop mouse merge cherry-pick fast-forward rebase branch commit
you-can-merge-branch-or = You can merge a branch or move a commit with the mouse — without switching branches or menus.
take-commit-row-in-graph = Take a <0>commit row</0> in the graph, a <1>branch label</1> in the graph or a <2>branch in the left panel</2> (local or remote).
drag-it-onto-branch-you = Drag it onto the <0>branch</0> you want to bring the changes into: onto a branch on the left or onto the graph row where that branch is. The target is highlighted with a green border.
release-it-menu-with-suitable = Release it — a menu with the suitable options appears.
whats-offered = What's offered
fast-forward-if-target-branch = <0>Fast-forward</0> — if the target branch has no new commits of its own. The branch just moves forward, without a merge commit and without switching.
merge-into-merge-regular-merge = <0>Merge into … (Merge)</0> — a regular merge.
cherry-pick-commit-into-cherry = <0>Cherry-pick commit into … (Cherry-pick)</0> — only for a commit: bring over just this one commit.
rebase-onto-opens-interactive-rebase = <0>Rebase … onto …</0> — opens an interactive rebase with preview.
if-target-branch-isnt-current = If the target branch isn't current, the app switches to it first (marked "switches branch"). With smart switching on, your uncommitted edits are stashed by themselves and come back when you return. If the commit is already in the branch, the menu says so: nothing to merge.
everything-is-undone-with-ctrl = Everything is undone with <0>Ctrl+Z</0>: first the merge or cherry-pick, then, on the next press, the branch switch. On a conflict the usual yellow bar appears — see the "Conflicts" section.
syncing-with-server = Syncing with the server
repository-sign-in-self-managed = repository sign-in self-managed own server domain gitlab github enterprise gitea bitbucket server type login pull push fetch server remote force upstream auto-update access username password auto check realtime interval ls-remote etag no connection authorization sign in token ssh key passphrase credential
fetch-find-out-whats-new = <0>Fetch</0> — find out what's new on the server without changing anything on your side. With <1>auto</1> on, the app does it by itself (see below).
pull-bring-changes-into-current = <0>Pull</0> — bring changes into the current branch. The arrow next to it picks the mode: regular (fast-forward if possible), fast-forward only, or rebase.
push-send-your-commits-for = <0>Push</0> — send your commits. For a new branch, upstream is set up automatically.
if-server-rejected-push-because = If the server rejected the push because other people's commits appeared there, the app offers to Pull (rebase) first and push again. <0>Force Push</0> is only needed after rewriting history (rebasing already pushed commits) — it replaces the branch on the server.
if-theres-no-access-app = If there's no access, the app explains why (wrong username, no permissions, unknown SSH key, etc.) and what to do.
if-server-refused-on-fetch = If the server refused on Fetch, Pull, Push or clone, the <0>Repository sign-in</0> window opens right away. The sign-in is saved <1>for this repository</1>, not for the whole server: different repositories on the same GitLab can have different accounts. Sign-in methods: <2>username and password</2>, <3>access token</3> (glpat-… / ghp_…; the username can be omitted) or an <4>SSH key</4> from ~/.ssh — with the key passphrase, if any.
at-top-of-window-where = At the top of the window — <0>where the repository is hosted</0>: <1>GitHub</1>, <2>GitLab</2> or <3>Own server</3> (Self-Managed — your company's GitLab, GitHub Enterprise, Gitea/Forgejo or Bitbucket). For your own server, enter the domain (optionally with a port), and the app asks the server for its type via the API; if it doesn't respond (VPN, internal network), choose the type manually. The sign-in methods are visible right away, even before the domain is entered. Choosing the server changes the <4>repository address</4> (the same project path on a different server) — it can also be edited entirely; on save, remote origin changes, and for a repository without a remote it's added. When cloning, the address is set in the clone window and doesn't change here.
no-key-on-ssh-key = No key — on the "SSH key" tab choose <0>Create a new key</0>: type (Ed25519, or RSA 4096 for old servers), file name, comment (your email from Git is filled in) and, optionally, a key passphrase with confirmation. Existing keys aren't overwritten. The public part is copied to the clipboard right away, and the <1>Open SSH Keys</1> button leads to the right server page — paste the key there. If the address starts with https://, there's also a <2>Switch the address to SSH</2> button (git@server:group/project.git) — the key works only with SSH addresses.
sign-in-and-retry-saves = "Sign in and retry" saves the credentials and immediately retries the interrupted operation. Credentials are encrypted with the system's tools; Git receives them directly, without sign-in windows. All saved sign-ins are in <0>Settings → Connections</0>: servers and the repositories tied to them, each with its sign-in method; there you can also change, forget, or sign in the open repository. A sign-in saved earlier for the whole server is shown as <1>shared</1> and applies to repositories without their own. If you enter nothing, it works as before — through Git Credential Manager.
background-server-check = Background server check
while-auto-is-on-app = While <0>auto</0> is on, the app notices new commits and branches on the server by itself — every 5 seconds by default. First it asks the server only for branch hashes (for GitLab with a saved token — via the API with ETag, otherwise — <1>git ls-remote</1>), and only if something changed does it run a real <2>fetch --prune</2>. So frequent checks don't load the server and don't hit limits.
only-open-tab-is-checked = Only the open tab is checked. When the window is minimized or in the background — every 90 seconds; when you come back to the window — a check right away.
while-you-commit-checkout-rebase = While you commit, checkout, rebase, etc. (or git is running in a terminal), the check is skipped — it never interferes with your commands.
no-connection-no-connection-appears = No connection — "no connection" appears in the status bar, without pop-ups; the pauses between attempts grow: 15 s → 30 s → 1 min → 5 min.
frequency-settings-sync-or-right = Frequency — <0>Settings → Sync</0> (or right-click "auto"): Realtime (5 s), Fast (15 s), Standard (30 s), Rare (5 min).
app-sees-fetch-or-pull = The app sees a fetch or pull in an external terminal right away — by changes in the .git folder.
guard-pre-commit-console-log = guard pre-commit console.log debugger print todo secret token key password aws bearer rule level forbid warn exclusions patterns gorynych-ignore repository turn off webstorm vs code revert index staged sync
before-each-commit-app-scans = Before each commit, the app scans the <0>added lines</0> of what goes into the commit in a fraction of a second and warns you (or, if so configured, prevents the commit) if it sees:
forgotten-debug-code-console-log = forgotten debug code: console.log, debugger, print(), breakpoint(), var_dump, .only in tests, "TODO: remove", conflict markers;
things-that-look-like-secrets = things that look like secrets: sk-… keys, GitHub/GitLab/Slack tokens, Bearer, AWS_…, JWT, private keys, passwords in code.
while-you-prepare-commit-banner = While you prepare a commit, a banner is visible above the <0>Commit</0> button: "Checked: nothing suspicious" or what was found. Files get a badge, and in the diff the line is marked with a bar on the left. When you click <1>Commit</1>, a list of findings opens: <2>Go back and fix</2> or <3>Commit anyway</3>. Secrets in the list are shown masked.
everything-is-configurable = Everything is configurable
settings-pre-commit-check-or = <0>Settings → Pre-commit check</0> (or the gear button on the banner):
check-before-committing-main-switch = <0>Check before committing</0> — the main switch. <1>Hint while preparing a commit</1> — the banner, badges and diff marks before you click "Commit"; if turned off, the check fires only on commit.
for-this-repository-turn-off = <0>For this repository</0> — turn off the check only here. The shield button on the banner does the same; to turn it back on — "turn on" on the banner. The list of such repositories is at the bottom of the settings.
each-rule-has-three-levels = Each rule has three levels: <0>Off</0>, <1>Warn</1> (ask whether to commit anyway) and <2>Forbid</2> — the commit isn't created until the line is fixed. The "all:" switch changes the level of the whole group at once.
your-own-rules-regular-expression = <0>Your own rules</0> — a regular expression, file extensions, a type. A rule can be tested on a line of code right away.
dont-check-files-path-patterns = <0>Don't check files</0> — path patterns: <1>*.md</1> — by name in any folder, <2>docs/**</2> — a whole folder, <3>**/*.test.*</3> — tests anywhere. Common options are added in one click.
check-skips-single-line-if = The check skips a single line if it has a <0>gorynych-ignore</0> comment — this way you can keep a needed console.log or a test key, even when the rule forbids the commit. The "Restore all defaults" button resets the settings.
if-you-edit-files-in = If you edit files in another program
you-staged-file-and-then = You staged a file and then reverted it to the last commit in WebStorm or VS Code — the app notices this and removes the change entirely: no "ghost" in "Staged files" and no stale warning. You edited a fully staged file outside — the new version goes into the index. The pre-commit check reruns on every file change on disk. Partially staged files aren't touched; to turn it off — Settings → Sync.
key-that-once-got-into = A key that once got into Git history stays there forever — even if you delete the file later. Such a key must be revoked.
action-builder-3 = Action builder
action-button-hotkey-shortcut-chain = action button hotkey shortcut chain template merge request pr automation
builds-chain-of-commands-for = Builds a chain of commands — for example, "create a branch from main, rebase, push, merge request" — and runs it with one button on the toolbar or a keyboard shortcut.
actions-action-builder-menu = The <0>Actions → Action builder…</0> menu
take-ready-made-template-on = Take a ready-made template on the left ("New task → MR", "Update branch from main", "Finish task", "Pull in the main branch") or create an empty action.
add-steps-with-add-step = Add steps with the <0>Add step</0> button: branches (create, switch, rebase, merge, delete), server (fetch, pull, push), changes (stash, pop, commit), merge request, a "continue?" question, a custom git command. The order is changed by dragging the step number.
assign-keyboard-shortcut-for-example = Assign a <0>keyboard shortcut</0> (for example <1>Ctrl+Alt+1</1>) and/or turn on the <2>button on the top toolbar</2>.
default-main-branch-main-master = <0>{"{"}default{"}"}</0> — the main branch (main / master), <1>{"{"}branch{"}"}</1> — the current one, <2>{"{"}start{"}"}</2> — the one it was started from, <3>{"{"}date{"}"}</3> — the date.
input-task-name-ask-at = <0>{"{"}input:Task name{"}"}</0> — ask at run time; <1>{"{"}input:Task name|slug{"}"}</1> — turn the answer into a branch name right away: "New login form" → new-login-form.
running-2 = Running
bottom-right-shows-which-step = The bottom right shows which step is running. An error stops the chain and explains why — fix it (for example, resolve a conflict) and click <0>Retry from step N</0>. Each step can be undone with <1>Ctrl+Z</1>, like a regular action.
merge-request-is-created-via = A merge request is created via the GitLab API (requires a token with the api scope). For GitHub, the pull request creation page opens.
diff-split-unified-whitespace-syntax = diff split unified whitespace syntax highlighting language search find ctrl+f case regex f3 f7 file changes
clicking-file-in-right-panel = Clicking a file in the right panel opens its changes in the center.
toggles-at-top-unified-one = Toggles at the top: <0>Unified</0> (one column) / <1>Split</1> (before | after), ignore whitespace, highlight what exactly changed within a line.
f7-shift-f7-to-next = <0>F7</0> / <1>Shift+F7</1> — to the next / previous change, <2>Alt+↑</2> / <3>Alt+↓</3> — to the neighboring file, <4>Esc</4> — close.
syntax-highlighting-language-is-detected = <0>Syntax highlighting</0> — the language is detected by the file extension or name (JavaScript/TypeScript, Python, Java, C/C++, C#, Go, Rust, PHP, HTML/Vue, CSS, SQL, YAML, Dockerfile and about 40 more). It works both in diffs and in the conflict editor; turned off with the <1></></1> button. Very large diffs are shown without highlighting — so as not to slow down.
search-in-changes-ctrl-f-or = <0>Search in changes</0> — <1>Ctrl+F</1> or the magnifier: all matches are highlighted, the current one in orange, "3 of 17" on the right. <2>Enter</2> / <3>Shift+Enter</3> (or <4>F3</4>) — to the next / previous. Next to the field — match case (<5>Alt+C</5>), regular expression (<6>Alt+R</6>) and "only in changed lines" (without context). The search string stays when you move to the neighboring file; <7>Esc</7> first closes the search, the second press — the diff.
each-hunk-has-action-buttons = Each hunk has action buttons: for uncommitted ones — <0>Stage</0> and <1>Discard</1>, for staged ones — <2>Unstage</2>, for a commit — <3>Revert in working folder</3>. When "ignore whitespace" is on, the buttons are hidden: hunks are computed from the exact text.
undo-and-safety = Undo and safety
undo-redo-revert-rollback-file = undo redo revert rollback file hunk reset revert restore project to commit
ctrl-z-ctrl-y-undo = <0>Ctrl+Z</0> / <1>Ctrl+Y</1> undo and redo: commit, checkout, creating and deleting branches (including on the server) and tags, merge, fast-forward, rebase, cherry-pick, revert, reset, stash, restoring files from a stash, reverting files and hunks. If something changed outside after the action, the app won't overwrite anything, but will explain why it can't undo.
restore-file-or-part-of = Restore a file or part of it — without a commit
right-click-file-in-commits = Right-click a file in the commit's file list:
restore-file-to-its-version-in = <0>Restore the file to its version in this commit</0> — the file in the working folder becomes as in the commit.
restore-file-to-its-version-before-this = <0>Restore the file to its version before this commit</0> — as it was before it (if the file didn't exist then, it's deleted).
revert-this-commits-changes-in-file = <0>Revert this commit's changes in the file</0> — remove only what this commit did; later edits stay.
same-for-single-hunk-revert = The same for a single hunk — the <0>Revert in working folder</0> button in the commit diff. Only the working folder changes: check the result and commit when you're ready. For uncommitted edits: right-click the file → <1>Discard changes in file</1>.
whole-project = The whole project
restore-files-from-commit-commit = <0>Restore files from the commit…</0> (the commit menu or the icon in the header of the commit panel on the right) — a new commit where all files are as in the selected one. History isn't rewritten, the branch isn't switched — safe even for pushed branches.
revert-commit-changes-revert-new = <0>Revert commit changes</0> (Revert) — a new commit that undoes one specific commit.
reset-to-this-commit-reset = <0>Reset … to this commit</0> (Reset) — moves the branch back: Soft, Mixed or Hard. Hard deletes uncommitted edits — the app asks for confirmation.
rebase-squash-fixup-reword-drop = rebase squash fixup reword drop order history message combine delete commit preview
lets-you-tidy-up-branchs = Lets you tidy up a branch's history: reorder commits, fix messages, combine or delete commits.
right-click-branch-commit-interactive = Right-click a branch commit → <0>Interactive rebase …</0> → "Commits after …" or "Starting from … (inclusive)". To move a branch onto another — right-click that branch → <1>Rebase … onto …</1>.
on-left-plan-new-commits = On the left — the plan (new commits on top). Drag commits with the mouse or <0>Alt+↑</0>/<1>Alt+↓</1>. For each, choose an action: <2>P</2> pick, <3>R</3> reword, <4>S</4> squash into the commit below, <5>F</5> fixup into the commit below without its message, <6>D</6> drop.
on-right-you-see-preview = On the right you see the <0>preview</0> right away: the "Now → After" graph, which branch files will change, whether there will be conflicts, whether Force Push will be needed.
click-apply-rebase-branch-will = Click <0>Apply rebase</0>. The branch will end up exactly as in the preview. <1>Ctrl+Z</1> restores everything.
until-you-click-apply-nothing = Until you click "Apply", nothing changes: neither the branch nor the files.
if-preview-shows-conflict-change = If the preview shows a conflict, change the plan or click <0>Start and resolve conflicts manually</0>: the rebase stops at the conflict, you resolve it (the "Conflicts" section) and click <1>Continue</1> in the yellow bar. <2>Abort</2> restores everything.
preview-needs-git-2-40 = The preview needs Git 2.40 or newer. If Git is older, the app tells you.
comparing-commits = Comparing commits
compare-comparison-diff-two-commits = compare comparison diff two commits branches difference search content find text
shows-how-any-two-commits = Shows how any two commits differ (or branches — select the commits they point to).
select-commit-and-second-one = Select a commit and <0>{ $a1 }</0> the second one.
or-right-click-compare-with = Or right-click → <0>Compare with HEAD</0>.
or-right-click-mark-for = Or right-click → <0>Mark for comparison</0> (the commit gets an "A" label), then on another commit → <1>Compare with marked</1>.
at-top-summary-how-many = At the top — a summary: how many files and lines changed and how many commits are between them (click — the commit list). Below — where most changes are by folder (clicking a folder filters the table) and a file table with size bars. Click a file — its diff, <0>Esc</0> — back to the comparison. The ⇄ button swaps "before" and "after".
content-search-path-content-switch = <0>Content search</0> — the <1>Path / Content</1> switch above the table or <2>Ctrl+F</2>: the text is searched in the added and deleted lines of all compared files (case-sensitive or not, regular expressions allowed). You see which files have matches and how many, and the lines themselves. Clicking a line opens the file's diff right at that match, with the same search string; <3>Alt+↓</3> goes to the next file with matches.
file-history-and-blame = File history and Blame
file-history-log-blame-authorship = file history log blame authorship who changed line author rename follow restore version whitespace
for-any-file-in-commit = For any file — in a commit, in a stash, in uncommitted changes (WIP), in the file list and tree, in a commit comparison — right-click → <0>File history (Log)</0> or <1>Blame</1>. The same buttons are in the header of an open file diff.
file-history-all-commits-that = <0>File history</0> — all commits that changed the file, under previous names too (git log --follow): hash, author, date, message and <1>+X −Y</1>. Click a commit — the file's diff in that commit on the right, <2>Alt+↑</2>/<3>Alt+↓</3> — neighboring commits.
compare-two-versions-second-commit = <0>Compare two versions</0>: { $a1 } the second commit (or the compare button on hover) — the difference between them on the right, even if the file had a different name then.
restore-file-to-this-version-file = <0>Restore the file to this version</0> — the file in the working folder becomes as in the selected commit. No commit is created; <1>Ctrl+Z</1> reverts it.
click-hash-show-commit-in = Click a hash — show the commit in the graph.
blame-to-left-of-each = <0>Blame</0> — to the left of each line: who changed it last and when. Lines of one commit are grouped into a block: avatar, author, message, date and short hash. The bar at the edge is the "age": the more recent the change, the brighter it is; old code is dimmer.
hover-over-block-full-commit = Hover over a block — the full commit message and statistics: how many files and lines it changed, including in this file.
click-hash-graph-goes-to = Click a hash — the graph goes to that commit.
blame-before-this-commit-arrow = <0>Blame before this commit</0> (the ↰ arrow on a block or the button in the tooltip) — blame of the file in the version before this commit: you see who wrote the line earlier. This way you can dig into a line's history, through renames too. <1>Back</1> or <2>Esc</2> — one step back.
ignore-whitespace-git-blame-w-2 = <0>Ignore whitespace</0> (git blame -w) — indentation-only edits don't count as line changes.
for-wip-file-blame-is = For a WIP file, blame is built from the working folder: new lines are marked "Not committed".
conflict-merge-rebase-pull-mine = conflict merge rebase pull mine theirs resolve continue abort
if-changes-overlapped-during-merge = If changes overlapped during a merge, rebase, pull or cherry-pick, a yellow bar appears at the top, and the conflicted files are in a separate list on the right.
click-resolve-conflicts-editor-opens = Click <0>Resolve conflicts</0> — an editor opens: "Mine" on the left, "Theirs" on the right, the result below.
for-each-conflict-block-choose = For each conflict block, choose a version or <0>Both</0>; the result can be edited manually. For the whole file there's "Take … everywhere".
save-and-next-ctrl-s = <0>Save and next</0> (<1>Ctrl+S</1>) — to the next file.
when-everything-is-resolved-continue = When everything is resolved — <0>Continue</0> in the yellow bar. Changed your mind — <1>Abort</1>, and everything goes back as it was.
stash-hide-pop-apply-drop = stash hide pop apply drop partial file selected apply selected hunk restore
stash-temporarily-hides-uncommitted = Stash temporarily hides uncommitted changes — for example, to switch to another branch.
stash-on-toolbar-stash-everything = <0>Stash</0> on the toolbar — stash everything; <1>Pop</1> — bring back the last stashed.
names-in-list-follow-one = Names in the list follow one style: your own message, "Edits in <branch>" for a Stash without a message, or the branch name marked<0>auto</0>; on the right — when it was stashed. Identical edits aren't stored twice: on a repeated Stash the old copy is removed.
stash-section-on-left-click = The <0>Stash</0> section on the left: click — view the contents; buttons and right-click — <1>Apply</1> (Apply, the stash stays),<2>Pop</2> (Pop — apply and delete), <3>Delete</3> (Drop; <4>Ctrl+Z</4> brings it back).
take-only-part-of-stash = Take only part of a stash
individual-files-check-them-in = <0>Individual files</0>: check them in the stash list — the <1>Apply selected (N)</1> button appears. The checkbox in the list header selects all files.
one-file-restore-button-when = <0>One file</0>: the restore button when hovering over the file row, or right-click → <1>Restore file from stash</1>.
individual-pieces-of-code-open = <0>Individual pieces of code</0>: open a file from the stash — each hunk in the diff has an <1>Apply</1> button.
files-go-to-working-folder = The files go to the working folder (as unstaged), and the stash stays in the list. New files from the stash are created, deleted ones are deleted. If the file has your unsaved edits, the app asks first. Everything is undone with <0>Ctrl+Z</0>.
search = Search
search-find-commit-filter-author = search find commit filter author hash file line changes code text
ctrl-f-commit-search-message = <0>Ctrl+F</0> — commit search: message, author, hash, branch — and text in file changes (the <1>In files</1> button, on by default). Matching commits are highlighted, the rest are dimmed; <2>Enter</2> / <3>Shift+Enter</3> — to the next and previous. Filter branches and tags on the left — <4>Ctrl+Alt+F</4>.
if-text-is-found-in = If the text is found in files, the commit in the graph gets a badge with the number of files, and on the right — a "found" block: the file and line (number, whether it was added or deleted) with the match highlighted. Such files are also highlighted in the commit's file list. Clicking a line opens the file's changes right at that spot, with the same search.
ci-cd-pipelines-and-runners = CI/CD: pipelines and runners
ci-cd-gitlab-pipeline-token = ci cd gitlab pipeline token variables schedule runner lint yml github actions gitea forgejo jenkins bitbucket check error config scenario merge request tag docker secrets artifacts cron dag skip ci notification
ci-cd-settings-in-repository = CI/CD settings in the repository
ci-cd-section-on-left = The <0>CI/CD</0> section on the left finds GitLab CI, GitHub Actions, Jenkins, Bitbucket and other systems' files. Clicking a file opens:
diagram-stages-and-jobs-at = <0>Diagram</0> — stages and jobs at a glance. For GitLab they can be changed: <1>+ job</1>, <2>+ Stage</2>, the <3>Edit</3> button in the job details.
check-what-will-break-in = <0>Check</0> — what will break in the configuration: for each problem it says <1>when</1> it will show up, <2>how</2> it will look (what error the server or the job log will show), <3>why</3> and <4>how to fix it</4>.
file-editor-with-on-fly = <0>File</0> — an editor with on-the-fly checks: lines with errors are marked red, with warnings — yellow; the diagram and check update as you type. <1>Ctrl+S</1> — save.
history-commits-that-changed-ci = <0>History</0> — commits that changed the CI settings.
execution-graph-dag-switch-above = <0>Execution graph (DAG)</0> — the switch above the diagram: jobs in columns by needs dependencies; lines show who waits for whom; hovering highlights the whole chain.
next-to-cron-in-schedule = Next to <0>cron</0> in a schedule — a plain-language description: "every day at 03:00 UTC".
in-editor-step-template-insert = In the editor: <0>Step template</0> — insert Checkout, dependency caching, a Docker image build or an SSH deploy at the cursor; after <1>tags:</1> / <2>runs-on:</2> the live runners' labels pop up.
while-changes-arent-saved-theres = While the changes aren't saved, there's a yellow bar at the top: "Changes" (what will change in the file), "Discard edits", "Save". The <0>Check in GitLab</0> button checks the draft on the server and shows which jobs will run.
configuration-check = Configuration check
check-runs-right-away-on = The check runs right away, on this computer, without sending the file to the server — both on the saved file and on the draft. Red is an error (the pipeline won't be created or the job will surely fail), yellow — may break, blue — a tip. Badges with the number of problems are visible on the "Check" tab and on the diagram's job cards; clicking a problem in the job details opens its breakdown.
syntax-and-keys-yaml-errors = <0>Syntax and keys</0>: YAML errors, duplicate keys, key typos (scirpt → script), invalid values of when, retry, parallel, timeout, expire_in, cache, environment, unknown GitHub Actions events and permissions.
links-needs-and-dependencies-on = <0>Links</0>: needs and dependencies on nonexistent or later jobs, cycles, extends and !reference, stages not from stages, on_stop without a stop job, include of files that don't exist.
scripts-against-repository-missing-file = <0>Scripts against the repository</0>: a missing file or execute permission (Permission denied), no package.json / lock file / npm script, no Makefile or target, cd into a nonexistent folder, docker without a daemon, apt-get in Alpine, commands missing from the image.
security-and-deprecations-tokens-and = <0>Security and deprecations</0>: tokens and passwords in plain text, disabled GitHub action versions and runner images, PR titles substituted right into commands.
for-gitlab-rules-are-evaluated = For GitLab, the rules are evaluated for typical events — push to the main and another branch, merge request, tag, schedule, manual run. The "What runs" table shows which jobs get into the pipeline and why; it separately finds duplicate pipelines (branch + MR), needs on a job that won't be in this pipeline, manual jobs that will stop the pipeline, a release without a tag.
network-includes-include-remote-project = Network includes (include: remote / project / template) can't be checked offline — they're marked with a tip. The "Check in GitLab" button gives a full check on the server.
pipelines-gitlab-github-gitea-forgejo = Pipelines: GitLab, GitHub, Gitea/Forgejo, Bitbucket
service-is-detected-by-itself = The service is detected by itself — from the remote address and the CI files (.gitlab-ci.yml, .github/workflows, .gitea/workflows, .forgejo/workflows, bitbucket-pipelines.yml). For your own server (GitLab Self-Managed, GitHub Enterprise, your own Gitea), you can specify the service and the <1>Base API URL</1> in the <0>Pipelines → Connection</0> tab.
repository-has-one-sign-in = A repository has one sign-in — for Pull, Push and pipelines. Sign in once in the <0>Repository sign-in</0> window, and pipelines open by themselves.
open-ci-cd-pipelines-and = Open <0>CI/CD → Pipelines</0> and click <1>Sign in to the repository</1> (it's the same window that appears on Pull or Push).
for-gitlab-access-token-with = For GitLab, an <0>access token</0> with the <1>api</1> scope is the most convenient — the "Create a token" link opens the GitLab page with the scopes already selected. One token works both for git and for pipelines.
if-you-sign-in-with = If you sign in with a password or SSH key, fill in the <0>CI/CD pipelines</0> field in the same window: GitLab doesn't accept a password or key for the API, and the token is saved together with this sign-in.
after-that-pipeline-statuses-are = After that, pipeline statuses are visible right in the graph, and in the "Pipelines" tab you can view stages and job logs, retry and cancel. The <0>Variables</0> and <1>Schedules</1> tabs let you add, change and delete CI/CD variables and pipeline schedules, and <2>Runners</2> — see who runs the jobs.
read-only-token-read-api-lets = A read-only token (read_api) lets you view; to run and change, you need a token with the api scope.
run-window-with-branch-and = <0>Run</0> — a window with the branch and parameters: inputs from workflow_dispatch (choice, checkbox, string), GitLab variables with descriptions, Bitbucket custom pipelines, your own KEY=VALUE variables.
cancel-running-pipeline-retry-failed = <0>Cancel</0> a running pipeline, <1>Retry failed</1> — only the failed jobs. A running job has a ticking timer.
job-log-ansi-colors-collapsible = <0>Job log</0>: ANSI colors, collapsible sections (::group:: and GitLab section), <1>Ctrl+F</1> search and the <2>To the first error ↓</2> button — it scrolls to the first line with Error / FAIL / exit code.
artifacts-of-finished-pipeline-with = <0>Artifacts</0> of a finished pipeline — with sizes, downloaded in one click.
secrets-and-variables-list-of = <0>Secrets and variables</0> — the list of repository variables and creating or replacing secrets (the service doesn't give out secret values).
whats-unavailable-for-particular-service = What's unavailable for a particular service (for example, pausing a runner on GitHub or runners in Bitbucket Cloud) is disabled, and the tooltip says why.
runners-tab-self-hosted-project = The <0>Runners</0> tab: self-hosted (project runners) and cloud — with Online, Busy (with a link to the job), Offline and Paused status, OS, architecture, version and labels. <1>Clean up inactive</1> deletes all offline self-hosted runners in one click.
click-runner-editor-labels-as = Click a runner — an editor: labels as chips, <0>Active / Paused</0> (the runner finishes the current jobs and won't take new ones), "Run untagged jobs", "Locked to current project", description, maximum timeout, deletion.
connect-runner-gets-registration-token = <0>Connect runner</0> — gets a registration token and gives a ready command (Docker, Linux, macOS, Windows) with the address, token and tags. <1>Run locally</1> starts a runner in Docker on this computer; you can stop it there too.
insert-into-config-on-runner = <0>Insert into config</0> on a runner card — inserts tags / runs-on with its labels into the CI file.
configuration-check-matches-tags-and = The configuration check matches tags and runs-on against live runners: if no online runner has the needed tag (or the matching ones are offline or paused), there'll be a warning "the pipeline will hang in the queue (Pending)".
statuses-in-graph-and-notifications = Statuses in the graph and notifications
commits-in-graph-have-pipeline = Commits in the graph have a pipeline badge (✓, ✕, ⟳, ⊘). The tooltip shows a summary of the jobs, a click opens the pipeline, and for a red one — the log of the failed job right away. The current branch's pipeline status is in the status bar at the bottom. When a running pipeline finishes, a system notification arrives. In the commit form, the <0>Skip CI</0> button adds [skip ci] to the message — such a commit won't start a pipeline.
in-settings-connections-each-repositorys = In <0>Settings → Connections</0>, each repository's sign-in shows whether pipelines work with it. CI/CD tokens saved separately in previous versions are moved into the repository sign-in automatically.
appearance-2 = Appearance
theme-light-dark-white-system = theme light dark white system background transparency appearance settings animation
ctrl-or-gear-at-top = <0>Ctrl+,</0> or the gear at the top right → <1>Appearance</1>: theme, background (gradients, your own image or Windows 11 transparency), panel transparency, blur, background animation. Changes are visible immediately and saved.
light-theme-white-panels-and = <0>Light</0> theme — white panels and dark text; branch colors in the graph, code highlighting and diffs are tuned for a light background.<1> System</1> — light or dark per the Windows/macOS setting: the theme switches by itself when the system changes mode.
interface-language-russkiy-or-english = <0>Interface language</0> — Русский or English: Settings → Appearance → Language. The window redraws immediately, and menus, tooltips and error messages are all switched; tabs and settings are kept.
if-somethings-wrong = If something's wrong
error-problem-git-not-found = error problem git not found access password ssh not working faq
git-not-found-and-fully = <0>"Git not found"</0> — { $a1 } and fully restart the app (and the terminal it was started from).
no-access-to-server-repository = <0>No access to the server</0> — the "Repository sign-in" window opens: choose where the repository is hosted and enter a username and password, a token or an SSH key. If sign-in worked but writing isn't allowed, check your permissions in the project on the server.
action-is-unavailable-gray-hover = <0>An action is unavailable (gray)</0> — hover over it; the tooltip explains why: for example, a merge isn't finished or you're not on a branch.
branch-cant-be-deleted-from = <0>A branch can't be deleted from the server</0> — it's protected or the main one. Remove the protection or change the default branch in the project settings on GitLab/GitHub.
no-connection-in-status-bar = <0>"no connection" in the status bar</0> — the background check couldn't reach the server (internet, VPN, server unavailable). The app retries a bit later by itself; the button next to it runs fetch right away and shows the detailed error.
did-something-by-mistake-ctrl = <0>Did something by mistake</0> — <1>Ctrl+Z</1>. The name of what will be undone is visible in the <2>Edit</2> menu.
new-features-arent-visible-after = <0>New features aren't visible after updating the app</0> — close the app completely (all windows) and open it again: some changes are picked up only at launch.
pre-commit-check-gets-in = <0>The pre-commit check gets in the way</0> — the banner above the "Commit" button: the shield button turns it off for the repository, the gear opens the rule settings.
graph-didnt-update-after-working = <0>The graph didn't update after working in a terminal</0> — the refresh button at the top right. Usually the app notices changes by itself.
guide-2 = { $a0 }<1>Guide</1>
search-guide = Search the guide

## src/components/InitRepoDialog.tsx

uploading = uploading { $a0 }
first-commit-2 = first commit
checking-repository = Checking the repository…
connect-to-remote-repository = Connect to a remote repository
new-git-repository = New Git repository
check-author-email = Check the author email ↓
enter-commit-authors-name-and = Enter the commit author's name and email ↓
connecting = Connecting…
creating = Creating…
connect-and-push = Connect and push
connect = Connect
empty-folder = Empty folder
folder = folder
folders = folders
folders-2 = folders
another-folder = Another folder
new-repository = New repository
git-init-from-scratch = git init from scratch
connect-existing = Connect existing
already-created-on-gitlab-github = already created on GitLab / GitHub
this-folder-has-no-git = This folder has no Git yet. We'll create a repository right here — the project files stay in place.
folder-is-already-inside-repository = The folder is already inside repository <0>{ $a1 }</0>. The new repository will be nested — usually that's not what you want.{ $a2 }
open-it = Open it
service-folders-will-get-into = Service folders will get into the commit: { $a0 }. Turn on .gitignore to exclude them.
excluded-via-gitignore = Excluded via .gitignore: { $a0 }
branch-for-first-push = Branch for the first push
main-branch = Main branch
already-in-project-well-leave = Already in the project — we'll leave it as is
already-in-repository-on-server = Already in the repository on the server — we'll use it
which-files-git-will-ignore = Which files Git will ignore
found = · found
rules-2 = { $a0 }{ $a1 } ({ $a2 } rules)
show-and-edit = Show and edit
already-in-project = Already in the project
file-with-project-name = A file with the project name
commit-project-files = Commit the project files
first-commit = First commit
on-top-of-last-commit = On top of the last commit from the server "{ $a0 }"
your-files-will-become-repositorys = Your files will become the repository's first commit
folder-is-empty-nothing-to = The folder is empty — nothing to commit yet
save-current-state-of-all = Save the current state of all files
author-2 = { $a0 }Author: <1>{ $a2 }</1><3><{ $a4 }></3>{ $a5 }
change-2 = change
git-doesnt-know-who-you = { $a0 }Git doesn't know who you are yet. The name and email will appear in commits.
use-for-all-repositories-on = { $a0 }Use for all repositories on this computer
push-to-server-right-away = Push to the server right away
to-on = to { $a0 } on { $a1 }
after-connecting = After connecting
optional-can-be-added-later = Optional — can be added later
copy-address-on-project-page = Copy the address on the project page in GitLab: the "Code" button → "Clone with HTTPS" or "Clone with SSH". The check changes nothing in the folder or on the server.
connecting-to-server-if-sign = { $a0 } Connecting to the server… If a sign-in window appears, sign in there.
address-changed-click-check-again = The address changed — click "Check" again.
access-granted-2 = { $a0 }<1>Access granted{ $a2 }</1>
repository-is-empty-your-files = The repository is empty. Your files will become the first commit and be pushed to the server.
branch-9 = { $a0 }Branch{ $a1 }
last-commit = Last commit: <0>"{ $a1 }"</0> · { $a2 } · { $a3 } { $a4 }
what-happens-to-files = What happens to the files:
identical-nothing-changes = Identical ({ $a0 }) — nothing changes
different-your-version-stays-difference = Different ({ $a0 }): { $a1 } — <2>your</2> version stays, the difference goes into the commit
only-on-server-will-appear = Only on the server ({ $a0 }): { $a1 } — will appear in the folder
rest-of-your-files-will = The rest of your files will be added as a new commit on top of the server history

## src/components/Loader.tsx

opening-repository = Opening the repository

## src/components/NewTabPage.tsx

connect-to-gitlab-github = Connect to GitLab / GitHub
recent = Recent
find-repository = Find a repository…
find-repository-2 = Find a repository
loading-list = { $a0 } Loading the list…
repositories-youve-opened-will-appear = Repositories you've opened will appear here. Start with "Open" — if the folder has no Git, the app offers to create it.
opened =
    {""}
    Opened { $a0 }
already-open-switch-to-tab =
    {""}
    Already open — switch to the tab
remove-from-recent = Remove { $a0 } from recent
remove-from-list-repository-itself = Remove from the list (the repository itself isn't touched)
work-faster-with-git-gorynych = Work faster with git-Горыныч
drag-branches-onto-branches-to = Drag branches onto branches to merge and rebase, switch without manual stashing, check commits for forgotten console.log and keys before pushing, watch GitLab pipelines and edit .gitlab-ci.yml — all in one window.
open-guide = { $a0 } Open the guide
resources = Resources
how-to-use-app-f1-2 = How to use the app (F1)
keyboard-shortcuts-2 = { $a0 } Keyboard shortcuts
settings-and-appearance-2 = { $a0 } Settings and appearance

## src/components/PipelineStatus.tsx

success = success
running-3 = running
queued = queued
preparing = preparing
waiting-for-resource = waiting for resource
waiting-for-manual-run = waiting for manual run
scheduled = scheduled
canceling = canceling
skipped = skipped
success-with-warnings = success, with warnings
on-schedule-2 = on schedule
started-manually = started manually
via-api = via API
trigger = trigger
child = child
from-another-project = from another project
from-chat = from chat
external-2 = external
release = release
after-another-workflow = after another workflow
called-workflow = called workflow
script-error-command-exited-with = script error (the command exited with a non-zero code)
runner-failure = runner failure
wait-time-exceeded = wait time exceeded
job-ran-longer-than-timeout = the job ran longer than the timeout
artifacts-from-dependencies-not-found = artifacts from dependencies not found
runner-doesnt-support-job = the runner doesn't support the job
project-is-archived = the project is archived
preconditions-not-met = preconditions not met
scheduler-error = scheduler error
data-integrity-violated = data integrity violated
api-error = API error
unknown-reason = unknown reason
min-2 = { $a0 } min{ $a1 }
s-3 = {" "}{ $a0 } s
h = { $a0 } h{ $a1 }
min-3 = {" "}{ $a0 } min

## src/components/RebaseView.tsx

pick = Pick
commit-stays-as-is = The commit stays as is
reword = Reword
commit-stays-only-text-changes = The commit stays, only the text changes
squash-into-commit-below = Squash into the commit below
changes-and-text-are-joined = The changes and text are joined to the commit below
fixup-into-commit-below-without = Fixup into the commit below without text
changes-are-joined-to-commit = The changes are joined to the commit below, its text doesn't change
commit-and-its-changes-will = The commit and its changes will disappear from history
interactive-rebase-2 = <0>Interactive rebase</0>{ $a1 }
branch-10 = branch <0>{ $a1 }</0>{ $a2 }
onto = {" "}→ onto { $a0 } <1>"{ $a2 }"</1>
commits-after-2 = , commits after { $a0 }
select-alt-move-p-r = ↑↓ select · Alt+↑↓ move · P R S F D — action
close-without-changes-esc = Close without changes (Esc)
collecting-commits = { $a0 } Collecting commits…
newest-on-top = <0>{ $a1 } { $a2 } · newest on top</0>{ $a3 }{ $a4 }
reset-plan = Reset plan
new-base = new base:
base-unchanged = base (unchanged):
bottom-commit-has-nothing-to = The bottom commit has nothing to combine with — choose another action for it
plan-changes-nothing = The plan changes nothing
branch-will-move-to-new = Branch <0>{ $a1 }</0> will move to the new history. Undo ({ $a2 }) restores it.
cant-apply-automatically-there-will = Can't apply automatically — there will be a conflict
start-anyway-ill-resolve-conflicts = Start anyway — I'll resolve the conflicts
run-real-git-rebase-it = Run a real git rebase: it will stop at the conflict, you resolve it and click "Continue". "Abort" restores everything.
start-and-resolve-conflicts-manually = { $a0 } Start and resolve conflicts manually
apply-rebase = { $a0 } Apply rebase
double-click-reword = Double-click — reword
empty-message = empty message
how-many-commits-will-be = How many commits will be combined with this one
conflict-2 = conflict
into-2 = → into { $a0 }
up-alt = Up (Alt+↑)
down-alt = Down (Alt+↓)
message-of-combined-commit-pcs = Message of the combined commit ({ $a0 } pcs.)
new-commit-message = New commit message
message-cant-be-empty = The message can't be empty
done-3 = Done ({ $a0 })
preview-computed-in-advance-working = Preview{ $a0 }<1>— computed in advance, the working folder isn't touched</1>
bottom-commit-cant-be-combined = The bottom commit can't be combined
squash-and-fixup-join-commit-to = Squash and fixup join a commit to the one below. For the bottom one, choose "Pick" or "Drop".
conflict-on-commit = Conflict on commit { $a0 } "{ $a1 }"
files-5 = Files
its-changes-dont-apply-onto = Its changes don't apply onto the commits below in the new order. Change the plan (for example, restore the order) or start the rebase and resolve the conflict manually.
choose-actions-for-commits-on = Choose actions for the commits on the left: reorder, reword, combine or drop.
will-go-through-without-conflicts = Will go through without conflicts
resulting-files-wont-change-only = The resulting files won't change — only the history changes.
resulting-files-will-change-list = The resulting files will change: { $a0 } { $a1 } (list below).
already-on-server = { $a0 } { $a1 } already on the server
after-rebase-branch-will-have = After the rebase, the branch will have to be sent with Force Push — that rewrites it for your colleagues too.
merge-commits-will-be-flattened = Merge commits ({ $a0 }) will be flattened
like-regular-git-rebase-it = Like a regular git rebase, it moves only regular commits — the history becomes linear.
uncommitted-changes = Uncommitted changes: { $a0 }
theyll-be-kept-if-rebase = They'll be kept. If the rebase changes the same files, the app will ask you to Commit or Stash first.
how-branch-files-will-change = How the branch files will change
no-changes-2 = no changes
moved = moved
new-message = new message
combined = combined
merges-into = merges into { $a0 }
now = Now
dropped = dropped
will-become-empty-skipped = will become empty — skipped
branchs-old-base = the branch's old base
after-4 = After
no-commits-will-remain = no commits will remain
will-stop-at-conflict = { $a0 } will stop at a conflict

## src/components/RefBadge.tsx

local-and-on-server = local and on server
local-4 = local = { $a0 }
server-3 = server
local-only = local only
branches-on-this-commit = Branches on this commit · { $a0 }
tags-3 = Tags · { $a0 }
yours-on-server-right-click = <0>{ $a1 } yours</0><2>·</2><3>{ $a4 } on server</3><5>·</5>right-click — actions
double-click-checkout-right-click = Double-click — checkout, right-click — all actions
right-click-actions = Right-click — actions
current-3 = current ·{" "}
checkout-creates-local-branch = Checkout { $a0 } (creates a local branch)

## src/components/Resizer.tsx

drag-to-change-width-double-click = Drag to change the width. Double-click — default

## src/components/RevertToDialog.tsx

restore-project-to-commit = Restore project to commit
restore-to = { $a0 }Restore to { $a1 }
computing-what-will-change = { $a0 } Computing what will change…
project-files-already-match-this = The project files already match this commit — nothing to revert.
all-files-will-become-as = All files will become as in this commit{ $a0 }. <1>{ $a2 } { $a3 }</1> will change (<4>+{ $a5 }</4> <6>−{ $a7 }</6>).
on-branch-2 = {" "}on branch <0>{ $a1 }</0>
changes-of-will-be-undone = The changes of { $a0 } { $a1 } will be undone:
this-commit-isnt-from-current = This commit isn't from the current branch's history. The files will become as in it anyway — make sure that's what you want.
safe-history-isnt-rewritten-new = Safe: history isn't rewritten. A new commit "Revert to { $a0 }" appears on top, the old commits stay. Changed your mind — click Undo.{ $a1 }
suitable-for-commits-already-pushed = {" "}Suitable for commits already pushed to the server too.
there-are-uncommitted-changes-they = There are uncommitted changes ({ $a0 }). They must be cleared before reverting.{ $a1 }
stash-and-continue = { $a0 } Stash and continue
untracked-files-have-same-names = Untracked files have the same names as the commit's files and will get in the way: <0>{ $a1 }</0>. Move them or stash them.
push-to-server-right-away-2 = { $a0 }{ $a1 }Push to the server right away

## src/components/SearchBar.tsx

all-time = All time
today = Today
n-7-days = 7 days
n-30-days = 30 days
period = Period…
message-sha-author-branch-or = Message, SHA, author, branch or text in files…
message-sha-author-branch = Message, SHA, author, branch…
text-in-file-changes-is = Text in file changes is searched too: the found commit, file and line are highlighted. Click — search only in commit descriptions
search-in-file-changes-too = Search in file changes too
in-files = { $a0 }In files
all-authors = All authors
authors = Authors: { $a0 }
find-author = Find an author
nobody-found = Nobody found
reset-authors = Reset authors
from-to = from{ $a0 }to{ $a1 }
searching-last-commits = Searching the last { $a0 } commits
searching-2 = Searching…
in-last = {" "}· in the last { $a0 }
commits-whose-changes-contain-text = Commits whose changes contain the text
in-files-2 = { $a0 } in files: { $a1 }{ $a2 }
previous-shift-enter-2 = Previous (Shift+Enter)
next-enter-2 = Next (Enter)
reset-2 = Reset

## src/components/SettingsDialog.tsx

sync-2 = Sync
connections = Connections
settings-2 = Settings
restore-default-appearance = Restore the default appearance
couldnt-load-image = Couldn't load the image
language = Language
window-will-redraw-in-selected = The window will redraw in the selected language; tabs and settings are kept.
theme = Theme
light-or-dark-per-windows = Light or dark — per the Windows/macOS settings, switches by itself
background = Background
requires-windows-11-version-22h2 = Requires Windows 11 (version 22H2 or newer)
choose-another-image = Choose another image…
choose-image = Choose an image…
image-blur = Image blur
dimming = Dimming
window-material = Window material
strong-blur-desktop-is-barely = Strong blur — the desktop is barely visible
light-tint-of-wallpaper-calmer = A light tint of the wallpaper, calmer and more economical
transparency-and-glass = Transparency and glass
panel-transparency = Panel transparency
opaque-panels = opaque panels
almost-pure-glass = almost pure glass
blur-under-glass = Blur under the glass
background-animation-smooth-movement-of = { $a0 }{ $a1 }Background animation<2>— smooth movement of spots and glow</2>
uncommitted-changes-when-switching = Uncommitted changes when switching branches
what-to-do-with-edits = What to do with edits in the working folder when you go to another branch.
ask-every-time = Ask every time
window-with-choice-stash-move = A window with a choice: stash, move or discard — with a hint about which files overlap with the target branch.
stash-automatically-smart-switching = Stash automatically (smart switching)
edits-are-stashed-under-current = The edits are stashed under the current branch's name and come back by themselves when you return to it.
move-to-new-branch = Move to the new branch
like-regular-git-switch-edits = Like a regular git switch: the edits go with you. If they overlap with the branch's edits, there'll be a conflict, and a copy stays in Stash.
how-stash-works = { $a0 } How "stash" works
youre-working-in-feature-and = You're working in feature-A and have edits. Double-click hotfix.
feature-edits-are-stashed-stash = The feature-A edits are stashed (stash "feature-A (auto)"), you're on a clean hotfix.
back-on-feature-edits-are = Back on feature-A — the edits are in place, staged ones included.
works-for-all-switches-from = Works for all switches from the app. If there's a conflict on return, the stash isn't deleted. Ctrl+Z switches back together with the edits.
gitlab-api-with-etag-not = GitLab API with ETag — a "not modified" response costs the server almost nothing
git-ls-remote-no-token = git ls-remote — no token, works with any server
auto-update-graph-and-branches = { $a0 }<1><2>Auto-update</2><3>The graph and branches update by themselves: on changes in the folder (including fetch/pull from a terminal) and on new commits on the server. The "auto" toggle in the status bar does the same.</3></1>
sync-index-with-edits-from = { $a0 }<1><2>Sync the index with edits from other programs</2><3>You reverted a staged file to the last commit in WebStorm or VS Code — the change disappears entirely, without a "ghost" in Staged and stale pre-commit check warnings. You edited a fully staged file outside — the new version goes into the index. Partially staged files (by hunks) aren't touched.</3></1>
how-often-to-check-server = How often to check the server
only-open-tab-is-checked-and = Only the open tab is checked, and only while the app window is active. When the window is minimized or in the background — every { $a0 } seconds.
first-we-ask-server-only = First we ask the server only for branch hashes — it's fast and almost free. A real <0>git fetch --prune</0> runs only if something changed.
while-you-commit-checkout-rebase-or = While you commit, checkout, rebase or do another action, the check waits — it never interferes with your commands.
no-connection-or-server-asks = No connection or the server asks to wait (429) — no pop-up errors, the pauses grow: { $a0 }.
min = { $a0 } min
for-gitlab-with-saved-token = For GitLab with a saved token, the API with ETag is used; otherwise — git ls-remote.
server-is-unavailable-errors-in = The server is unavailable: { $a0 }. Errors in a row: { $a1 }.
last-check-at-method = Last check at { $a0 }{ $a1 }. Method: { $a2 }.
ms = {" "}({ $a0 } ms)
not-checked-yet-first-check = Not checked yet — the first check comes a couple of seconds after opening the repository.
sign-in-unavailable = Sign-in unavailable.
view-and-actions = view and actions
view-only-2 = view only
pipelines-token-from-previous-version = Pipelines: token from the previous version{ $a0 } — sign in to the repository to have a single sign-in
pipelines-this-sign-in-doesnt = Pipelines: this sign-in doesn't work for the API — open "Edit"
pipelines-still-using-token-from = Pipelines: still using the token from the previous version
pipelines-doesnt-work-for-api = Pipelines: { $a0 } doesn't work for the API — add a token in "Edit"
password-3 = password
pipelines-same-sign-in = Pipelines: the same sign-in{ $a0 }{ $a1 }{ $a2 }{ $a3 }
with-api-token = {" "}(with an API token)
will-be-checked-on-first = {" "}— will be checked on first use
enter-it-again = — enter it again
forget-2 = <0>Forget?</0>{ $a1 }{ $a2 }
yes-2 = Yes
repository-sign-ins = { $a0 }<1>Repository sign-ins</1>{ $a2 }
sign-in-to-open-repository = { $a0 } Sign in to the open repository…
sign-in-is-saved-for = A sign-in is saved for a specific repository and covers everything: Pull, Push, cloning and CI/CD pipelines. On one server, different repositories can have different accounts. In the sign-in window you choose where the repository is hosted: GitHub, GitLab or your own server (Self-Managed).
none-yet-sign-in-is = None yet. A sign-in is saved by itself when a server first asks for authorization on Pull, Push or clone.
type-not-selected = type not selected
forget-server-sign-ins-of = Forget the server: sign-ins of all its repositories, the shared sign-in and the selected type
forget-3 = Forget { $a0 }
sign-in-to-repository = Sign in to the repository
edit-sign-in-pull-push = Edit sign-in (Pull/Push and pipelines)
forget-this-repositorys-sign-in = Forget this repository's sign-in
applies-to-repositories-whose-sign = { $a0 }<1>{ $a2 } · applies to repositories whose sign-in doesn't open pipelines</1>
pipeline-token-for-whole-server = Pipeline token for the whole server (from the previous version)
ci-cd-of-all-repositories = CI/CD of all repositories on { $a0 }
forget-shared-ci-cd-token = Forget the shared CI/CD token (saved earlier, before binding to repositories)
forget-shared-ci-cd-token-2 = Forget the shared CI/CD token
shared-sign-in-for-all-repositories = Shared sign-in for all repositories on the server
all-repositories-on = all repositories on { $a0 }
forget-shared-sign-in-saved = Forget the shared sign-in (saved earlier, before binding to repositories)
forget-shared-sign-in = Forget the shared sign-in

## src/components/Sidebar.tsx

filter-branches-and-tags = Filter branches and tags…
filter-branches-and-tags-ctrl = Filter branches and tags (Ctrl+Alt+F)
branches-are-grouped-into-folders = Branches are grouped into folders (feature/, bugfix/…) — show as a list
group-branches-into-folders-by = Group branches into folders by "/"
double-click-checkout-right-click-2 =
    { $a0 }
    { $a1 }
    Double-click — checkout, right-click — actions
only-on-your-side-not = Only on your side — not pushed to the server yet
in-sync-with = In sync with { $a0 }
tracks = Tracks { $a0 }{ $a1 }{ $a2 }
ahead = {" "}· { $a0 } ahead
behind = {" "}· { $a0 } behind
stashed-edits-of-branch-theyll =
    Stashed edits of branch { $a0 }{ $a1 }{ $a2 }
    They'll come back by themselves when you switch to this branch (stash "{ $a3 }" marked "auto")
no-commits = No commits
on-server-3 = On server
remote-isnt-configured = Remote isn't configured
click-view-changes-right-click =
    { $a0 }{ $a1 }
    { $a2 } · { $a3 }
    { $a4 }Click — view the changes, right-click — actions
itll-come-back-by-itself =
    It'll come back by itself when you switch to this branch
    {""}
auto = auto
no-stashed-changes = No stashed changes
tag-5 =
    Tag { $a0 }
    { $a1 }
no-tags = No tags
click-view-settings =
    { $a0 }: { $a1 }
    Click — view the settings
ci-cd-service-isnt-determined = The CI/CD service isn't determined — specify it and the API address
sign-in-to-repository-same-sign-in = Sign in to the repository — the same sign-in will open pipelines
last-pipeline-of-branch = The last pipeline of branch { $a0 }: #{ $a1 } — { $a2 }
pipelines-3 = { $a0 }<1>Pipelines</1><2>{ $a3 }</2>
sign-in-2 = sign in
looking-for-gitlab-ci-yml = Looking for .gitlab-ci.yml, .github/workflows, Jenkinsfile, bitbucket-pipelines.yml and others
not-found-4 = Not found
on-server-double-click-checkout =
    { $a0 } — on the server{ $a1 }
    Double-click — checkout, right-click — actions
local-is-on-same-commit =
    {""}
    Local { $a0 } is on the same commit
local-differs =
    {""}
    Local { $a0 } differs
no-local-copy =
    {""}
    No local copy
current-branch-is-here = The current branch is here

## src/components/StatusBar.tsx

no-upstream = No upstream
head-isnt-on-branch-new = HEAD isn't on a branch: new commits won't get into any branch
relative-to-upstream = Relative to upstream
unpushed-commits = Unpushed commits: { $a0 }
will-arrive-on-pull-2 = Will arrive on Pull: { $a0 }
go-to-head =
    Go to HEAD
    { $a0 }
    { $a1 }
    { $a2 } · { $a3 }
go-to-head-2 =
    Go to HEAD
    { $a0 }
last-pipeline-of-branch-click =
    { $a0 }: the last pipeline of branch { $a1 } — #{ $a2 }, { $a3 }{ $a4 }
    Click — { $a5 }
in-progress-2 = { $a0 } in progress
uncommitted-changes-2 = Uncommitted changes
click-right-click-more-actions =
    { $a0 }
    Click — { $a1 }, right-click — more actions
gitlab-api-and-git-ls = GitLab API and git ls-remote
auto-update-is-on-graph = Auto-update is on: the graph updates on any changes in the folder.
server-is-checked-window-not = The server is checked { $a0 } (window not focused — every { $a1 } s); fetch — only if something changed there.
last-check = Last check: { $a0 }{ $a1 }{ $a2 }.
in-6 = {" "}in { $a0 }
ms-2 = , { $a0 } ms
click-turn-off-right-click = Click — turn off, right-click — settings.
auto-update-is-off-click = Auto-update is off. Click — turn on, right-click — settings.
auto-2 = auto · { $a0 }
auto-off = auto off
server-is-unavailable-click-to =
    The server is unavailable: { $a0 }{ $a1 }
    Click to fetch now.
next-attempt-in-s =
    {""}
    Next attempt in { $a0 } s
last-fetch-failed = The last fetch failed: { $a0 }
new-data-from-server-received = New data from the server received at { $a0 }. Click to fetch now.
get-changes-from-server-fetch = Get changes from the server (fetch)
no-connection = no connection

## src/components/TitleBar.tsx

edit = Edit
view = View
actions = Actions
help = Help
new-tab-ctrl-t = New tab (Ctrl+T)
restore = Restore
maximize = Maximize
new-tab-open-clone-or = New tab — open, clone or create a repository
close-tab-ctrl-w = Close tab (Ctrl+W)

## src/components/Toasts.tsx

details-2 = { $a0 } Details

## src/components/TokenSetup.tsx

repository-has-no-remote-nothing = The repository has no remote — nothing to sign in to.
checking-sign-in = Checking the sign-in…
signed-in = Signed in
ci-cd-token-from-previous-version = CI/CD token from the previous version — sign in to the repository so everything works with one sign-in
repository-sign-in-one-for = Repository sign-in — one for Pull, Push and pipelines
valid-until-2 = {" "}· valid until { $a0 }
read-only-token-pipelines-and = Read-only token: pipelines and logs are visible, but you can't run, retry or cancel. Actions require a token with the "api" scope.
edit-repository-sign-in = { $a0 } Edit repository sign-in
repository-on-isnt-signed-in = The repository on { $a0 } isn't signed in yet. Sign in once — this sign-in will work both for Pull/Push and for pipelines.
edit-repository-sign-in-2 = Edit repository sign-in

## src/components/Toolbar.tsx

pull-fast-forward-otherwise-merge = Pull — fast-forward, otherwise merge
pull-fast-forward-only = Pull — fast-forward only
pull-rebase = Pull — rebase
no-remote = No remote
from-6 = {" "}from { $a0 }
push-to = Push to { $a0 }
push-publish-branch-and-set = Push — publish the branch and set upstream
repository-2 = repository
click-open-another-repository-right =
    { $a0 }
    Click — open another repository, right-click — open the folder or a terminal
nothing-to-undo = Nothing to undo
nothing-to-redo = Nothing to redo
create-branch-4 = Create branch
stash-changes-2 = Stash { $a0 } changes
apply-3 = Apply { $a0 }: { $a1 }
search-commits-ctrl-f = Search commits (Ctrl+F)
settings-ctrl = Settings (Ctrl+,)
repository-has-no-remote = The repository has no remote
has-no-remote = { $a0 } has no remote
checking-3 = checking…
checking-access-to-remote = Checking access to the remote
no-access = no access
read-only = read only
read-and-write = { $a0 }: read and write
read-write-not-checked = { $a0 }: read (write not checked)
click-for-details =
    { $a0 }
    Click for details
pull-and-fetch-modes = Pull and Fetch modes
selected-mode-becomes-default = The selected mode becomes the default
switch-branch-ctrl-b = Switch branch (Ctrl+B)

## src/lib/actions.ts

find-out-whats-new-on = Find out what's new on the server
fetch-download-new-data-from = Fetch — download new data from the server
bring-changes-into-current-branch = Bring changes into the current branch
mode = Mode
fast-forward-if-possible = Fast-forward if possible
fast-forward-only = Fast-forward only
fast-forward-only-2 = {" "}(fast-forward only)
push-current-branch = Push the current branch
force-push-force-with-lease = Force push (--force-with-lease) — needed after rebasing a pushed branch
force-push-current-branch = Force push the current branch
push-current-branch-2 = Push the current branch
new-branch-from-any-branch = A new branch from any branch or commit
feature-input-task-name-slug = feature/{"{"}input:Task name|slug{"}"}
feature-input-name-slug = feature/{"{"}input:Name|slug{"}"}
from-7 = From
switch-to-it-right-away = Switch to it right away
create-branch-from = Create branch "{ $a0 }" from { $a1 }{ $a2 }
and-switch = {" "}and switch
checkout-respects-smart-switching = Checkout (respects "smart switching")
move-current-branch-on-top = Move the current branch on top of another
onto-2 = Onto
rebase-current-branch-onto = Rebase the current branch onto { $a0 }
merge-branch-into-current-one = Merge a branch into the current one
which-branch-to-merge = Which branch to merge
merge-into-current-branch = Merge { $a0 } into the current branch
local-branch-undo-brings-it = Local branch (Undo brings it back)
even-if-not-merged = Even if not merged
delete-branch-5 = Delete branch { $a0 }{ $a1 }
forced = {" "}(forced)
stash-uncommitted-changes = Stash uncommitted changes
label-optional = Label (optional)
stash-changes-3 = Stash changes{ $a0 }
pop-last-stash-2 = Pop the last stash
with-pre-commit-guard-check = With the Pre-commit Guard check
message = Message
input-commit-message = {"{"}input:Commit message{"}"}
stage-all-changes-first-stage = Stage all changes first (Stage all)
commit-7 = Commit "{ $a0 }"{ $a1 }
of-all-changes = {" "}of all changes
gitlab-via-api-github-pr = GitLab — via the API, GitHub — the PR page opens
into-which-branch = Into which branch
title = Title
draft = Draft
open-in-browser = Open in the browser
from-current-branch-into = { $a0 } from the current branch into { $a1 }
draft-mr = Draft MR
ask = Ask
pause-continue-or-stop = Pause: continue or stop
question = Question
ask-2 = Ask: "{ $a0 }"
custom-git-command = Custom git command
any-git-command-no-shell = Any git command (no shell)
command = Command
server-4 = Server
new-task-mr = New task → MR
branch-from-main-rebase-onto = A branch from main, rebase onto a fresh base, push and merge request
new-task = New task
input-task-name = {"{"}input:Task name{"}"}
update-branch-from-main = Update branch from main
fetch-rebase-onto-origin-main = Fetch, rebase onto origin/main and force push
update-from-main = Update from main
finish-task = Finish task
commit-all-changes-push-and = Commit all changes, push and merge request
send-for-review = Send for review
pull-in-main-branch = Pull in the main branch
switch-to-main-pull-and = Switch to main, pull and come back
update-main = Update main
branch-merged-clean-up = Branch merged — clean up
switch-to-main-pull-and-delete = Switch to main, pull and delete the branch you started from
clean-up-merged-branch = Clean up the merged branch
delete-branch-start-after-updating = Delete branch {"{"}start{"}"} after updating main?
current-branch-at-time-of = the current branch at the time of the step
branch-action-was-started-from = the branch the action was started from
main-branch-main-master = the main branch (main / master)
todays-date-2026-10-26 = today's date, 2026-10-26
input-question = {"{"}input:Question{"}"}
ask-at-run-time = ask at run time
input-question-slug = {"{"}input:Question|slug{"}"}
ask-and-make-branch-name = ask and make a branch name: "New form" → new-form
modifier-is-needed-ctrl-alt = A modifier is needed: Ctrl, Alt or Shift
shift-letter-gets-in-way = Shift + letter gets in the way of typing — add Ctrl or Alt
this-shortcut-is-already-taken = This shortcut is already taken by the app
already-assigned-to-action = Already assigned to the action "{ $a0 }"
enter-name-2 = Enter a name
add-at-least-one-step = Add at least one step
step-unknown-type = Step { $a0 }: unknown type
step-fill-in = Step { $a0 } "{ $a1 }": fill in "{ $a2 }"

## src/lib/ansi.ts

error-2 = Error:{" "}
warning-2 = Warning:{" "}
group = Group

## src/lib/appearance.ts

dark = Dark
light = Light
midnight = Midnight
dracula = Dracula
monokai = Monokai
forest = Forest
sakura = Sakura
black = Black
glow = Glow
soft-colored-spots-behind-glass = Soft colored spots behind glass
aurora = Aurora
shimmering-bands-like-northern-lights = Shimmering bands, like the northern lights
grid = Grid
thin-grid-and-glow-from = A thin grid and a glow from above
gradient = Gradient
calm-static-gradient = A calm static gradient
solid = Solid
no-effects = No effects
image-2 = Image
your-own-image-with-blur = Your own image with blur and dimming
desktop-shows-through-window-mica = The desktop shows through the window (Mica / Acrylic, Windows 11)
system = System

## src/lib/ciSnippets.ts

repository-checkout = Repository checkout
dependency-caching = Dependency caching
docker-image-build = Docker image build
ssh-deploy = SSH deploy
name-ssh-deploy-uses-appleboy =
    - name: SSH deploy
    {"  "}uses: appleboy/ssh-action@v1
    {"  "}with:
    {"    "}host: ${"{"}{"{"} secrets.DEPLOY_HOST {"}"}{"}"}
    {"    "}username: ${"{"}{"{"} secrets.DEPLOY_USER {"}"}{"}"}
    {"    "}key: ${"{"}{"{"} secrets.DEPLOY_KEY {"}"}{"}"}
    {"    "}script: |
    {"      "}cd /srv/app
    {"      "}git pull
    {"      "}./restart.sh
checkout-clone-depth-and-strategy = Checkout: clone depth and strategy
job-docker-image-build = Job: Docker image build
job-ssh-deploy = Job: SSH deploy
checkout-clone-depth = Checkout: clone depth
step-docker-image-build = Step: Docker image build
step-name-image-build-services =
    - step:
    {"    "}name: Image build
    {"    "}services: [docker]
    {"    "}script:
    {"      "}- docker build -t app:$BITBUCKET_COMMIT .
step-ssh-deploy = Step: SSH deploy
step-name-deploy-deployment-production =
    - step:
    {"    "}name: Deploy
    {"    "}deployment: production
    {"    "}trigger: manual
    {"    "}script:
    {"      "}- pipe: atlassian/ssh-run:0.8.1
    {"        "}variables:
    {"          "}SSH_USER: $DEPLOY_USER
    {"          "}SERVER: $DEPLOY_HOST
    {"          "}COMMAND: 'cd /srv/app && git pull && ./restart.sh'

## src/lib/commitMsg.ts

new-feature = New feature
bug-fix = Bug fix
code-rework-without-behavior-changes = Code rework without behavior changes
chores-dependencies-configs-build = Chores: dependencies, configs, build
documentation = Documentation
formatting-whitespace-no-logic-changes = Formatting, whitespace, no logic changes
tests = Tests
performance = Performance
in-square-brackets-at-start = In square brackets at the start
instead-of-scope-without-type = Instead of the scope; without a type — in parentheses at the start
at-end-as-on-github = At the end, as on GitHub
on-separate-line-at-end = On a separate line at the end of the Description
what-was-done-how-to-test = What was done / How to test
what-was-done-how-to-test-1 =
    What was done:
    -{" "}
    {""}
    How to test:
    1.{" "}
    {""}
    Issue: {"{"}ticket{"}"}
problem-cause-solution-how-to =
    Problem:
    {""}
    Cause:
    {""}
    Solution:
    {""}
    How to test:
    {""}
breaking-change = Breaking change
breaking-change-what-to-do =
    BREAKING CHANGE:{" "}
    {""}
    What to do when upgrading:
    -{" "}

## src/lib/cron.ts

every-day-at-3-00 = Every day at 3:00
weekdays-at-9-00 = Weekdays at 9:00
every-hour = Every hour
every-15-minutes = Every 15 minutes
mondays-at-4-00 = Mondays at 4:00
n-1st-of-every-month = The 1st of every month at 2:00

## src/lib/format.ts

just-now = just now
min-ago = { $a0 } min ago
h-ago = { $a0 } h ago
yesterday = yesterday
d-ago = { $a0 } d ago

## src/lib/graphView.ts

branch-tag = Branch / tag
graph = Graph
sha-commit-hash = SHA (commit hash)
author-3 = Author
date-time = Date / time
compact = Compact
standard = Standard
roomy = Roomy
absolute = Absolute
relative = Relative
n-15-min-ago-yesterday = 15 min ago, yesterday
avatars-initials = Avatars / initials
compact-dots = Compact dots

## src/lib/guardRules.ts

aws-key-aws = AWS key (AWS_…)
sk-api-key = sk-… API key
github-token = GitHub token
gitlab-token = GitLab token
slack-token-2 = Slack token
google-api-key-2 = Google API key
bearer-token = Bearer token
password-or-key-in-code = Password or key in code
conflict-marker = Conflict marker
only-in-tests = {"."}only in tests
looks-like-secret = Looks like a secret
forgotten-debug-code = Forgotten debug code
custom-rules = Custom rules
off = Off
rule-isnt-checked = The rule isn't checked
warn = Warn
show-and-ask-whether-to = Show and ask whether to commit anyway
forbid = Forbid
commit-isnt-created-until-line = The commit isn't created until the line is fixed or marked gorynych-ignore

## src/lib/highlight.ts

expression-matches-empty-string = The expression matches an empty string
invalid-expression = Invalid expression: { $a0 }

## src/lib/platform.ts

are-encrypted = are encrypted
is-encrypted = is encrypted
stored = stored
in-macos-keychain-and-only = { $a0 } { $a1 } in the macOS Keychain and { $a2 } only on this computer.
with-windows-tools-dpapi-and = { $a0 } { $a1 } with Windows tools (DPAPI) and { $a2 } only on this computer.
by-system-keyring-gnome-keyring = { $a0 } { $a1 } by the system keyring (GNOME Keyring / KWallet) and { $a2 } only on this computer.
install-git-run-xcode-select = install Git: run xcode-select --install in Terminal (or brew install git)
install-git-for-windows-git-scm = install Git for Windows (git-scm.com)
install-git-from-package-manager = install Git from the package manager (for example, sudo apt install git)
show-in-finder = Show in Finder
open-in-explorer = Open in Explorer
open-in-file-manager = Open in file manager
open-in-terminal = Open in Terminal
open-in-terminal-command-line = Open in terminal (command line)
open-in-terminal-2 = Open in terminal

## src/lib/servers.ts

other-git-server = Other Git server
git-server = Git server
ghp-or-github-pat = ghp_… or github_pat_…
access-token-2 = access token

## src/lib/stashName.ts

stashed-when-switching-branches = stashed when switching branches
edits-in = Edits in { $a0 }
at = at { $a0 }{ $a1 }
ago = {" "}ago

## src/lib/syncStatus.ts

realtime = Realtime
every-5-seconds = every 5 seconds
fast = Fast
every-15-seconds = every 15 seconds
standard-2 = Standard
every-30-seconds = every 30 seconds
rare = Rare
every-5-minutes = every 5 minutes

## src/state/repoStore.ts

window-api-is-unavailable = window.api is unavailable — the interface is open outside the app (run gorynych-tauri).

## src/state/syncStore.ts

no-connection-to-server = No connection to the server

## src/lib/mainBranches.ts (главные ветки графа)

main-branches = Main branches
main-branch-pinned = Main branch: its own lane on the left
make-main-branch = Make main branch
remove-from-main-branches = Remove from main branches
main-branches-limit = At most { $a0 } main branches
add-main-branch = Add branch…
detect-main-branches-automatically = Detect automatically
main-branches-auto-hint = Picked automatically: main, master or trunk, and develop or dev
main-branch-absent = No such branch in the repository
main-branch-unloaded = Branch tip is outside the loaded history
no-main-branches = No main branches — lanes are laid out as usual
find-branch = Find a branch…
lanes-hidden-stretch-column = Hidden lanes: { $a0 }. Widen the column or double-click its border

## Догрузка истории графа (repoStore.loadMore)

loading-history = Loading history…
load-more-history = Load more

## Граф: клавиатура и доступность (этап 6)

commit-graph-table = Commit graph

## Граф: поиск (этап 6)

only-matches = Only matches
only-matches-on = Only matching commits are shown — click to bring back the whole graph
only-matches-off = Show only matching commits, hide the rest
go-to-match = Match: row { $a0 }
