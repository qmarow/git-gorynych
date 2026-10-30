// Проверка .gitlab-ci.yml: то, что GitLab отклонит при создании пайплайна, то, что упадёт при выполнении заданий,
// и «прогон» типичных событий (push, merge request, тег, расписание, ручной запуск) — какие задания попадут в пайплайн.
const { isObj, arr, q, suggest, didYouMean, parseExpr, evalExpr, durationSeconds, SECRET_NAME, SECRET_VALUE, looksLikeVarRef } = require('./ciCheckBase.cjs');
const { checkScripts } = require('./ciCheckScripts.cjs');

/* =================== Справочники GitLab =================== */

const GLOBAL_KEYS = ['default', 'include', 'stages', 'types', 'variables', 'workflow', 'image', 'services', 'cache', 'before_script', 'after_script', 'spec'];
const JOB_KEYS = [
  'after_script', 'allow_failure', 'artifacts', 'before_script', 'cache', 'coverage', 'dast_configuration', 'dependencies', 'environment',
  'except', 'extends', 'hooks', 'identity', 'id_tokens', 'image', 'inherit', 'interruptible', 'manual_confirmation', 'needs', 'only', 'pages',
  'parallel', 'publish', 'release', 'resource_group', 'retry', 'rules', 'run', 'script', 'secrets', 'services', 'stage', 'start_in', 'tags',
  'timeout', 'trigger', 'variables', 'when',
];
const DEFAULT_KEYS = ['after_script', 'artifacts', 'before_script', 'cache', 'hooks', 'id_tokens', 'image', 'interruptible', 'retry', 'services', 'tags', 'timeout'];
const WORKFLOW_KEYS = ['name', 'rules', 'auto_cancel'];
const RULE_KEYS = ['if', 'changes', 'exists', 'when', 'allow_failure', 'variables', 'needs', 'interruptible', 'start_in'];
const WORKFLOW_RULE_KEYS = ['if', 'changes', 'exists', 'when', 'variables', 'auto_cancel'];
const ARTIFACT_KEYS = ['paths', 'exclude', 'expire_in', 'expose_as', 'name', 'public', 'access', 'reports', 'untracked', 'when'];
const CACHE_KEYS = ['key', 'paths', 'untracked', 'unprotect', 'when', 'policy', 'fallback_keys'];
const ENV_KEYS = ['name', 'url', 'on_stop', 'action', 'auto_stop_in', 'kubernetes', 'deployment_tier'];
const REPORTS = [
  'accessibility', 'annotations', 'api_fuzzing', 'browser_performance', 'coverage_report', 'codequality', 'container_scanning', 'coverage_fuzzing',
  'cyclonedx', 'dast', 'dependency_scanning', 'dotenv', 'junit', 'load_performance', 'metrics', 'requirements', 'repository_xray', 'sast',
  'secret_detection', 'terraform',
];
const REMOVED_REPORTS = {
  cobertura: 'coverage_report: { coverage_format: cobertura, path: … } (cobertura удалён в GitLab 15.0)',
  performance: 'browser_performance (performance удалён в GitLab 15.0)',
  license_management: 'cyclonedx / сканирование лицензий (удалено в GitLab 16.0)',
  license_scanning: 'cyclonedx / сканирование лицензий (удалено в GitLab 16.0)',
};
const JOB_WHEN = ['on_success', 'on_failure', 'always', 'manual', 'delayed', 'never'];
const RULE_WHEN = ['on_success', 'on_failure', 'always', 'manual', 'delayed', 'never'];
const SIMPLE_WHEN = ['on_success', 'on_failure', 'always'];
const RETRY_WHEN = [
  'always', 'unknown_failure', 'script_failure', 'api_failure', 'stuck_or_timeout_failure', 'runner_system_failure', 'runner_unsupported',
  'stale_schedule', 'job_execution_timeout', 'archived_failure', 'unmet_prerequisites', 'scheduler_failure', 'data_integrity_failure',
];
const ENV_ACTIONS = ['start', 'prepare', 'stop', 'verify', 'access'];
const TIERS = ['production', 'staging', 'testing', 'development', 'other'];
const PIPELINE_SOURCES = [
  'api', 'chat', 'external', 'external_pull_request_event', 'merge_request_event', 'ondemand_dast_scan', 'ondemand_dast_validation',
  'parent_pipeline', 'pipeline', 'push', 'schedule', 'security_orchestration_policy', 'trigger', 'web', 'webide',
];
const ONLY_REFS = ['api', 'branches', 'chat', 'external', 'external_pull_requests', 'merge_requests', 'pipelines', 'pushes', 'schedules', 'tags', 'triggers', 'web'];
const ONLY_KEYS = ['refs', 'variables', 'changes', 'kubernetes'];

const PREDEFINED = new Set(
  `CI CI_API_V4_URL CI_API_GRAPHQL_URL CI_BUILDS_DIR CI_COMMIT_AUTHOR CI_COMMIT_BEFORE_SHA CI_COMMIT_BRANCH CI_COMMIT_DESCRIPTION CI_COMMIT_MESSAGE
  CI_COMMIT_MESSAGE_IS_TRUNCATED CI_COMMIT_REF_NAME CI_COMMIT_REF_PROTECTED CI_COMMIT_REF_SLUG CI_COMMIT_SHA CI_COMMIT_SHORT_SHA CI_COMMIT_TAG
  CI_COMMIT_TAG_MESSAGE CI_COMMIT_TIMESTAMP CI_COMMIT_TITLE CI_CONCURRENT_ID CI_CONCURRENT_PROJECT_ID CI_CONFIG_PATH CI_DEBUG_TRACE CI_DEBUG_SERVICES
  CI_DEFAULT_BRANCH CI_DEFAULT_BRANCH_SLUG CI_DEPENDENCY_PROXY_DIRECT_GROUP_IMAGE_PREFIX CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX
  CI_DEPENDENCY_PROXY_PASSWORD CI_DEPENDENCY_PROXY_SERVER CI_DEPENDENCY_PROXY_USER CI_DEPLOY_FREEZE CI_DEPLOY_PASSWORD CI_DEPLOY_USER
  CI_DISPOSABLE_ENVIRONMENT CI_ENVIRONMENT_NAME CI_ENVIRONMENT_SLUG CI_ENVIRONMENT_URL CI_ENVIRONMENT_ACTION CI_ENVIRONMENT_TIER CI_RELEASE_DESCRIPTION
  CI_GITLAB_FIPS_MODE CI_HAS_OPEN_REQUIREMENTS CI_JOB_ID CI_JOB_IMAGE CI_JOB_JWT CI_JOB_MANUAL CI_JOB_NAME CI_JOB_NAME_SLUG CI_JOB_STAGE CI_JOB_STATUS
  CI_JOB_TIMEOUT CI_JOB_TOKEN CI_JOB_URL CI_JOB_STARTED_AT CI_KUBERNETES_ACTIVE CI_NODE_INDEX CI_NODE_TOTAL CI_OPEN_MERGE_REQUESTS CI_PAGES_DOMAIN
  CI_PAGES_HOSTNAME CI_PAGES_URL CI_PIPELINE_ID CI_PIPELINE_IID CI_PIPELINE_SOURCE CI_PIPELINE_TRIGGERED CI_PIPELINE_URL CI_PIPELINE_CREATED_AT
  CI_PIPELINE_NAME CI_PIPELINE_SCHEDULE_DESCRIPTION CI_PROJECT_DIR CI_PROJECT_ID CI_PROJECT_NAME CI_PROJECT_NAMESPACE CI_PROJECT_NAMESPACE_ID
  CI_PROJECT_NAMESPACE_SLUG CI_PROJECT_PATH_SLUG CI_PROJECT_PATH CI_PROJECT_REPOSITORY_LANGUAGES CI_PROJECT_ROOT_NAMESPACE CI_PROJECT_TITLE
  CI_PROJECT_DESCRIPTION CI_PROJECT_URL CI_PROJECT_VISIBILITY CI_PROJECT_CLASSIFICATION_LABEL CI_REGISTRY CI_REGISTRY_IMAGE CI_REGISTRY_PASSWORD
  CI_REGISTRY_USER CI_REPOSITORY_URL CI_RUNNER_DESCRIPTION CI_RUNNER_EXECUTABLE_ARCH CI_RUNNER_ID CI_RUNNER_REVISION CI_RUNNER_SHORT_TOKEN
  CI_RUNNER_TAGS CI_RUNNER_VERSION CI_SERVER_FQDN CI_SERVER_HOST CI_SERVER_NAME CI_SERVER_PORT CI_SERVER_PROTOCOL CI_SERVER_SHELL_SSH_HOST
  CI_SERVER_SHELL_SSH_PORT CI_SERVER_REVISION CI_SERVER_TLS_CA_FILE CI_SERVER_TLS_CERT_FILE CI_SERVER_TLS_KEY_FILE CI_SERVER_URL
  CI_SERVER_VERSION_MAJOR CI_SERVER_VERSION_MINOR CI_SERVER_VERSION_PATCH CI_SERVER_VERSION CI_SERVER CI_SHARED_ENVIRONMENT CI_TEMPLATE_REGISTRY_HOST
  CI_TRIGGER_SHORT_TOKEN CI_MERGE_REQUEST_APPROVED CI_MERGE_REQUEST_ASSIGNEES CI_MERGE_REQUEST_DIFF_BASE_SHA CI_MERGE_REQUEST_DIFF_ID
  CI_MERGE_REQUEST_EVENT_TYPE CI_MERGE_REQUEST_DESCRIPTION CI_MERGE_REQUEST_DESCRIPTION_IS_TRUNCATED CI_MERGE_REQUEST_ID CI_MERGE_REQUEST_IID
  CI_MERGE_REQUEST_LABELS CI_MERGE_REQUEST_MILESTONE CI_MERGE_REQUEST_PROJECT_ID CI_MERGE_REQUEST_PROJECT_PATH CI_MERGE_REQUEST_PROJECT_URL
  CI_MERGE_REQUEST_REF_PATH CI_MERGE_REQUEST_SOURCE_BRANCH_NAME CI_MERGE_REQUEST_SOURCE_BRANCH_PROTECTED CI_MERGE_REQUEST_SOURCE_BRANCH_SHA
  CI_MERGE_REQUEST_SOURCE_PROJECT_ID CI_MERGE_REQUEST_SOURCE_PROJECT_PATH CI_MERGE_REQUEST_SOURCE_PROJECT_URL CI_MERGE_REQUEST_SQUASH_ON_MERGE
  CI_MERGE_REQUEST_TARGET_BRANCH_NAME CI_MERGE_REQUEST_TARGET_BRANCH_PROTECTED CI_MERGE_REQUEST_TARGET_BRANCH_SHA CI_MERGE_REQUEST_TITLE
  CI_MERGE_REQUEST_DRAFT CI_EXTERNAL_PULL_REQUEST_IID CI_EXTERNAL_PULL_REQUEST_SOURCE_REPOSITORY CI_EXTERNAL_PULL_REQUEST_TARGET_REPOSITORY
  CI_EXTERNAL_PULL_REQUEST_SOURCE_BRANCH_NAME CI_EXTERNAL_PULL_REQUEST_SOURCE_BRANCH_SHA CI_EXTERNAL_PULL_REQUEST_TARGET_BRANCH_NAME
  CI_EXTERNAL_PULL_REQUEST_TARGET_BRANCH_SHA GITLAB_CI GITLAB_FEATURES GITLAB_USER_EMAIL GITLAB_USER_ID GITLAB_USER_LOGIN GITLAB_USER_NAME GITLAB_ENV
  TRIGGER_PAYLOAD CHAT_CHANNEL CHAT_INPUT CHAT_USER_ID KUBECONFIG`.split(/\s+/),
);
// Переменные, значение которых зависит от содержимого (сообщения коммита, меток MR, проекта) — их итог не предсказать
const CONTENT_VARS = /^(CI_COMMIT_(MESSAGE|TITLE|DESCRIPTION|AUTHOR|TAG_MESSAGE)|CI_MERGE_REQUEST_(LABELS|TITLE|DESCRIPTION|DRAFT|APPROVED|ASSIGNEES|MILESTONE)|GITLAB_USER_\w+|CI_PROJECT_\w+|CI_SERVER_\w+|CI_PIPELINE_SCHEDULE_DESCRIPTION|CI_RUNNER_\w+|CI_REGISTRY\w*|CI_API_\w+)$/;
const OLD_VARS = {
  CI_BUILD_REF_NAME: 'CI_COMMIT_REF_NAME',
  CI_BUILD_REF: 'CI_COMMIT_SHA',
  CI_BUILD_TAG: 'CI_COMMIT_TAG',
  CI_BUILD_NAME: 'CI_JOB_NAME',
  CI_BUILD_STAGE: 'CI_JOB_STAGE',
  CI_BUILD_ID: 'CI_JOB_ID',
  CI_BUILD_TOKEN: 'CI_JOB_TOKEN',
  CI_BUILD_REF_SLUG: 'CI_COMMIT_REF_SLUG',
  CI_BUILD_BEFORE_SHA: 'CI_COMMIT_BEFORE_SHA',
  CI_BUILD_REPO: 'CI_REPOSITORY_URL',
  CI_BUILD_TRIGGERED: 'CI_PIPELINE_TRIGGERED',
  CI_BUILD_MANUAL: 'CI_JOB_MANUAL',
};

const CONFIG_WHEN = 'Сразу при push — GitLab проверяет весь файл ещё до создания пайплайна';
const rejected = (msg) => `GitLab не создаст пайплайн и покажет ошибку: «${msg}». Ни одно задание не запустится.`;
const STOP = 'Пайплайн не создаётся ни для какого события, пока ошибка не исправлена.';

/* =================== Проверка =================== */

function checkGitlab(result, ctx) {
  const { pos, repo, add, defBranch, branches } = ctx;
  const raw = result._raw;
  const main = result.files[0]?.path ?? '.gitlab-ci.yml';
  const globals = raw.globals ?? {};
  const defaults = isObj(globals.default) ? globals.default : {};

  /* ---------- Где что лежит ---------- */
  const L = (file, keyPath) => pos.line(file, keyPath);
  const globalLoc = (keyPath) => {
    const def = [...raw.globalDefs].reverse().find((d) => d.key === keyPath[0]);
    const file = def?.source ?? main;
    return { file, line: L(file, keyPath) ?? def?.line ?? null };
  };
  const chainOf = (name) => raw.resolveJob(name)?.chain ?? [];
  const has = (obj, keyPath) => {
    let v = obj;
    for (const k of keyPath) {
      if (v != null && typeof v === 'object' && k in v) v = v[k];
      else return false;
    }
    return true;
  };
  /** Файл и строка, где у задания (или у его родителя по extends) задан ключ */
  const locate = (name, keyPath = []) => {
    for (const n of [name, ...chainOf(name)]) {
      const defs = raw.jobDefs.filter((d) => d.name === n).reverse();
      for (const d of defs) if (has(d.value, keyPath)) return { file: d.source, line: L(d.source, [n, ...keyPath]) ?? d.line };
    }
    if (keyPath.length && has(defaults, keyPath)) return globalLoc(['default', ...keyPath]);
    if (keyPath.length && keyPath[0] in globals) return globalLoc(keyPath);
    const e = raw.jobs.get(name);
    return { file: e?.source ?? main, line: e?.line ?? null };
  };
  const jobIssue = (name, keyPath, o) => add({ when: CONFIG_WHEN, ...locate(name, keyPath), job: name, ...o });
  const globIssue = (keyPath, o) => add({ when: CONFIG_WHEN, ...globalLoc(keyPath), ...o });

  /* ---------- Повторяющиеся ключи ---------- */
  for (const f of result.files) {
    for (const d of pos.duplicates(f.path)) {
      const where = d.path.length ? `в ${q(d.path.join(' → '))}` : 'на верхнем уровне';
      add({
        id: 'yaml-duplicate-key',
        severity: 'warning',
        title: `Ключ ${q(d.key)} повторяется ${where}`,
        when: CONFIG_WHEN,
        how: 'Ошибки не будет: YAML молча возьмёт последнее значение, а первое (строка ' + (d.first ?? '?') + ') будет потеряно целиком.',
        why: 'В одном блоке YAML ключ может встречаться только один раз; повтор обычно — результат копирования.',
        fix: 'Удалите лишний блок или объедините их в один.',
        file: f.path,
        line: d.line,
      });
    }
  }

  /* ---------- Верхний уровень ---------- */
  const visible = [];
  const seenNames = new Set();
  for (const def of raw.jobDefs) {
    if (seenNames.has(def.name)) continue;
    seenNames.add(def.name);
    const entry = raw.jobs.get(def.name);
    if (!entry) {
      // Значение не карта: «build: echo hi» или опечатка в глобальном ключе (stage: [...])
      const near = suggest(def.name, GLOBAL_KEYS);
      add({
        id: near ? 'global-typo' : 'job-not-hash',
        severity: 'error',
        title: near ? `Неизвестный раздел ${q(def.name)} — похоже на ${q(near)}` : `${q(def.name)}: задание должно быть набором ключей`,
        when: CONFIG_WHEN,
        how: rejected(`jobs:${def.name} config should be a hash`),
        why: near
          ? `Всё, что не является служебным разделом (${near} и др.), GitLab считает заданием, а задание не может быть ${Array.isArray(def.value) ? 'списком' : 'строкой'}.`
          : 'На верхнем уровне все ключи, кроме служебных (stages, variables, default…), — это задания; задание описывается картой с script/stage и т.д.',
        fix: near ? `Переименуйте ${q(def.name)} в ${q(near)}.` : `Оформите как задание:\n${def.name}:\n  script:\n    - ${typeof def.value === 'string' ? def.value : '…'}`,
        file: def.source,
        line: def.line,
      });
      continue;
    }
    if (!def.name.startsWith('.')) visible.push(def.name);
  }
  if (visible.length === 0 && !result.errors.some((e) => e.severity === 'error')) {
    {
      add({
        id: 'no-visible-jobs',
        severity: 'error',
        title: 'В конфигурации нет ни одного задания',
        when: CONFIG_WHEN,
        how: rejected('jobs config should contain at least one visible job'),
        why: raw.jobs.size ? 'Есть только скрытые задания (имя начинается с точки) — они служат шаблонами и сами не запускаются.' : 'В файле только служебные разделы.',
        fix: 'Добавьте задание без точки в начале имени, например:\nbuild:\n  script:\n    - echo "ok"',
        file: main,
        line: 1,
      });
    }
  }

  // Типы служебных разделов
  if (globals.stages !== undefined && !Array.isArray(globals.stages)) {
    globIssue(['stages'], { id: 'stages-not-list', severity: 'error', title: 'stages должен быть списком', how: rejected('stages config should be an array of strings'), why: 'Этапы перечисляются списком в порядке выполнения.', fix: 'stages:\n  - build\n  - test\n  - deploy' });
  }
  if (globals.types !== undefined) {
    globIssue(['types'], { id: 'types-removed', severity: 'warning', title: 'Раздел types устарел', how: 'В новых версиях GitLab (17.0+) ключ удалён — файл перестанет проходить проверку.', why: 'types — старое название stages.', fix: 'Переименуйте types в stages.' });
  }
  if (globals.variables !== undefined && !isObj(globals.variables)) {
    globIssue(['variables'], { id: 'variables-not-hash', severity: 'error', title: 'variables должен быть набором «ИМЯ: значение»', how: rejected('variables config should be a hash of key value pairs'), why: 'Переменные задаются картой, а не списком.', fix: 'variables:\n  NODE_ENV: production' });
  }
  for (const key of ['image', 'services', 'cache', 'before_script', 'after_script']) {
    if (key in globals && raw.globalDefs.some((d) => d.key === key)) {
      globIssue([key], {
        id: 'global-deprecated',
        severity: 'info',
        title: `Глобальный ${key} устарел — используйте default:`,
        how: 'Сейчас работает, но GitLab пометил такую запись устаревшей и может убрать её.',
        why: `Ключи заданий на верхнем уровне (${key}) заменены разделом default.`,
        fix: `default:\n  ${key}: …`,
      });
    }
  }
  if (isObj(globals.default)) {
    for (const k of Object.keys(globals.default)) {
      if (!DEFAULT_KEYS.includes(k)) {
        globIssue(['default', k], {
          id: 'default-unknown-key',
          severity: 'error',
          title: `default: неизвестный ключ ${q(k)}`,
          how: rejected(`default config contains unknown keys: ${k}`),
          why: `В default допустимы только: ${DEFAULT_KEYS.join(', ')}.${k === 'stage' || k === 'variables' || k === 'rules' || k === 'only' ? ` ${q(k)} задаётся в каждом задании (variables — на верхнем уровне).` : ''}${didYouMean(k, DEFAULT_KEYS)}`,
          fix: 'Уберите ключ из default или перенесите в задания.',
        });
      }
    }
  }

  /* ---------- workflow ---------- */
  const workflow = isObj(globals.workflow) ? globals.workflow : null;
  if (globals.workflow !== undefined && !workflow) {
    globIssue(['workflow'], { id: 'workflow-not-hash', severity: 'error', title: 'workflow должен быть картой', how: rejected('workflow config should be a hash'), why: 'workflow содержит rules / name / auto_cancel.', fix: 'workflow:\n  rules:\n    - if: $CI_COMMIT_BRANCH' });
  }
  if (workflow) {
    for (const k of Object.keys(workflow)) {
      if (!WORKFLOW_KEYS.includes(k)) globIssue(['workflow', k], { id: 'workflow-unknown-key', severity: 'error', title: `workflow: неизвестный ключ ${q(k)}`, how: rejected(`workflow config contains unknown keys: ${k}`), why: `Допустимы: ${WORKFLOW_KEYS.join(', ')}.${didYouMean(k, WORKFLOW_KEYS)}`, fix: 'Уберите или переименуйте ключ.' });
    }
    if (workflow.rules !== undefined) checkRules(workflow.rules, { workflow: true, at: (kp) => globalLoc(['workflow', 'rules', ...kp]), who: 'workflow' });
  }

  /* ---------- include ---------- */
  const offline = [];
  for (const inc of raw.includes) {
    const at = { file: inc.from, line: pos.find(inc.from, String(inc.value).split(/[:@]/)[0].trim()) ?? L(inc.from, ['include']) };
    if (inc.type === 'local') {
      if (/\$/.test(inc.value)) {
        add({ id: 'include-variable', severity: 'info', title: `include ${inc.value}: путь с переменной`, when: CONFIG_WHEN, how: 'Проверить файл заранее нельзя: он определяется переменной в момент создания пайплайна.', why: 'В include разрешены только некоторые переменные (проекта, группы, предопределённые).', fix: 'Убедитесь, что при всех значениях переменной файл существует.', ...at });
      } else if (!/\.ya?ml$/i.test(inc.value) && !/[*]$/.test(inc.value)) {
        add({ id: 'include-not-yaml', severity: 'error', title: `include ${inc.value}: не YAML-файл`, when: CONFIG_WHEN, how: rejected(`Included file \`${inc.value}\` does not have YAML extension!`), why: 'Подключать можно только файлы .yml / .yaml.', fix: 'Переименуйте файл в .yml или укажите правильный.', ...at });
      } else if (inc.error && inc.error.includes('не найден')) {
        add({
          id: 'include-local-missing',
          severity: 'error',
          title: `include ${inc.value}: файла нет в репозитории`,
          when: CONFIG_WHEN,
          how: rejected(`Local file \`${inc.value}\` does not exist!`),
          why: `Файл ищется от корня репозитория в той же ветке/коммите${/[*]/.test(inc.value) ? '; под шаблон не подходит ни один файл' : ''}.`,
          fix: 'Проверьте путь (от корня, регистр букв) и что файл закоммичен.',
          ...at,
        });
      } else if (inc.error) {
        add({ id: 'include-depth', severity: 'error', title: `include ${inc.value}: ${inc.error}`, when: CONFIG_WHEN, how: rejected('Maximum of nested includes reached'), why: 'GitLab ограничивает вложенность подключений.', fix: 'Сократите цепочку include.', ...at });
      }
    } else if (inc.type === 'remote') {
      if (/^http:\/\//i.test(inc.value)) add({ id: 'include-http', severity: 'warning', title: `include ${inc.value}: по незащищённому http`, when: CONFIG_WHEN, how: 'Файл может быть подменён по дороге — и подменённые задания выполнятся с вашими переменными и токенами.', why: 'remote-файлы скачиваются при каждом создании пайплайна.', fix: 'Используйте https:// или храните файл в репозитории (include: local / project).', ...at });
      offline.push(inc);
    } else if (inc.type === 'unknown') {
      add({ id: 'include-unknown', severity: 'error', title: 'include: непонятная запись', when: CONFIG_WHEN, how: rejected('Include config contains unknown keys'), why: 'Подключение должно содержать один из ключей: local, project (+ file), remote, template, component.', fix: 'include:\n  - local: ci/build.yml', ...at });
    } else offline.push(inc);
    if (inc.type === 'project' && !/:\s*\S/.test(inc.value)) {
      add({ id: 'include-project-no-file', severity: 'error', title: 'include project без file', when: CONFIG_WHEN, how: rejected('Include config is missing the file key'), why: 'Для подключения из другого проекта нужно указать file.', fix: 'include:\n  - project: group/ci\n    file: /templates/build.yml', ...at });
    }
  }
  if (offline.length) {
    add({
      id: 'include-offline',
      severity: 'info',
      title: `Не проверены подключения из сети: ${offline.length}`,
      when: CONFIG_WHEN,
      how: 'Если такой файл недоступен или в нём ошибка, GitLab не создаст пайплайн.',
      why: `${offline.map((i) => `${i.type}: ${i.value}`).slice(0, 4).join('; ')}${offline.length > 4 ? '…' : ''} — эти файлы лежат вне репозитория, без сети их не проверить; задания из них в проверке не учтены.`,
      fix: 'Проверьте итоговую конфигурацию в GitLab: CI/CD → Editor → Full configuration (или Validate).',
      file: offline[0].from,
      line: pos.find(offline[0].from, String(offline[0].value).split(/[:@]/)[0].trim()),
    });
  }

  /* ---------- Переопределение в разных файлах ---------- */
  const byName = new Map();
  for (const d of raw.jobDefs) byName.set(d.name, [...(byName.get(d.name) ?? []), d]);
  for (const [name, defs] of byName) {
    const files = [...new Set(defs.map((d) => d.source))];
    if (files.length > 1) {
      add({ id: 'job-redefined', severity: 'info', title: `${q(name)} описано в нескольких файлах`, when: CONFIG_WHEN, how: `Итоговое задание — слияние описаний: ключи из ${files.at(-1) === main ? 'основного файла' : q(files.at(-1))} перекрывают ключи из ${files.slice(0, -1).map(q).join(', ')}; списки (script, rules) заменяются целиком.`, why: 'Так работает include: одноимённые задания объединяются.', fix: 'Если это сделано намеренно — всё в порядке; иначе переименуйте одно из заданий.', file: defs.at(-1).source, line: defs.at(-1).line, job: name });
    }
  }

  /* ---------- extends и !reference ---------- */
  const extendsGraph = new Map([...raw.jobs].map(([n, e]) => [n, arr(e.config.extends)]));
  const extendsReported = new Set();
  for (const [name, parents] of extendsGraph) {
    const e = raw.jobs.get(name);
    if (e.config.extends !== undefined && !(typeof e.config.extends === 'string' || (Array.isArray(e.config.extends) && e.config.extends.every((x) => typeof x === 'string')))) {
      jobIssue(name, ['extends'], { id: 'extends-type', severity: 'error', title: `${q(name)}: extends должен быть именем или списком имён`, how: rejected(`jobs:${name}:extends config should be an array of strings or a string`), why: 'extends указывает имена заданий-шаблонов.', fix: 'extends: .template или extends: [.a, .b]' });
      continue;
    }
    for (const p of parents) {
      if (!raw.jobs.has(p)) {
        jobIssue(name, ['extends'], {
          id: 'extends-unknown',
          severity: offline.length ? 'warning' : 'error',
          title: `${q(name)}: extends ссылается на несуществующее ${q(p)}`,
          how: rejected(`${name}: unknown keys in \`extends\` (${p})`),
          why: `Задания или шаблона ${q(p)} нет ни в этом файле, ни в подключённых локальных.${didYouMean(p, [...raw.jobs.keys()])}${offline.length ? ' (Возможно, он в подключении из сети — тогда всё в порядке.)' : ''}`,
          fix: 'Поправьте имя или добавьте шаблон.',
        });
      }
    }
    // Цикл и глубина
    const walk = (n, stack) => {
      if (stack.includes(n)) return { cycle: [...stack.slice(stack.indexOf(n)), n] };
      let depth = stack.length;
      for (const p of extendsGraph.get(n) ?? []) {
        const r = walk(p, [...stack, n]);
        if (r.cycle) return r;
        depth = Math.max(depth, r.depth);
      }
      return { depth };
    };
    const r = walk(name, []);
    if (r.cycle) {
      const key = [...new Set(r.cycle)].sort().join('|');
      if (!extendsReported.has(key)) {
        extendsReported.add(key);
        jobIssue(name, ['extends'], { id: 'extends-cycle', severity: 'error', title: `Циклическое наследование: ${r.cycle.join(' → ')}`, how: rejected('circular dependency detected in `extends`'), why: 'Задания наследуют друг друга по кругу — итоговую конфигурацию собрать невозможно.', fix: 'Разорвите цикл: вынесите общее в отдельный шаблон.' });
      }
    } else if (r.depth > 11) {
      jobIssue(name, ['extends'], { id: 'extends-depth', severity: 'error', title: `${q(name)}: слишком глубокое наследование (${r.depth})`, how: rejected('nesting too deep in `extends`'), why: 'GitLab допускает не более 11 уровней extends.', fix: 'Упростите цепочку шаблонов.' });
    }
  }
  const refsUsed = new Set();
  const findRefs = (value, keyPath, cb) => {
    if (Array.isArray(value)) value.forEach((v, i) => findRefs(v, [...keyPath, i], cb));
    else if (isObj(value)) {
      if (value.__reference) cb(value.__reference, keyPath);
      else for (const [k, v] of Object.entries(value)) findRefs(v, [...keyPath, k], cb);
    }
  };
  for (const d of raw.jobDefs) {
    findRefs(d.value, [d.name], (ref, keyPath) => {
      const [target, ...keys] = ref.map(String);
      refsUsed.add(target);
      let t = target in globals ? globals[target] : raw.resolveJob(target)?.config;
      for (const k of keys) t = t?.[k];
      if (t === undefined) {
        add({
          id: 'reference-missing',
          severity: offline.length && !raw.jobs.has(target) ? 'warning' : 'error',
          title: `!reference [${ref.join(', ')}] — такого нет`,
          when: CONFIG_WHEN,
          how: rejected(`!reference ["${ref.join('", "')}"] could not be found`),
          why: raw.jobs.has(target) || target in globals ? `У ${q(target)} нет ключа ${q(keys.join(' → '))}.` : `Задания ${q(target)} нет.${didYouMean(target, [...raw.jobs.keys()])}`,
          fix: 'Поправьте имя задания/ключа в !reference.',
          file: d.source,
          line: L(d.source, keyPath) ?? d.line,
          job: d.name,
        });
      }
    });
  }
  // Шаблоны, которые никто не использует
  const usedTemplates = new Set([...refsUsed]);
  for (const n of raw.jobs.keys()) for (const c of chainOf(n)) usedTemplates.add(c);
  for (const [n, e] of raw.jobs) {
    if (n.startsWith('.') && !usedTemplates.has(n) && !/^\.(pre|post)$/.test(n) && !e.config.script && Object.keys(e.config).length) {
      // Якоря YAML (&anchor) тоже используют скрытые задания — их ищем в тексте
      const text = result.files.find((f) => f.path === e.source)?.text ?? '';
      const anchored = new RegExp(`^\\s*${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*&`, 'm').test(text);
      if (!anchored) add({ id: 'template-unused', severity: 'info', title: `Шаблон ${q(n)} нигде не используется`, when: CONFIG_WHEN, how: 'Ничего не сломается — он просто не участвует в пайплайне.', why: 'Ни одно задание не наследует его через extends и не ссылается через !reference.', fix: 'Удалите шаблон или подключите его через extends.', file: e.source, line: e.line, job: n });
    }
  }

  /* ---------- Этапы ---------- */
  const declared = raw.declaredStages;
  const stageNames = raw.stageNames;
  const dupStages = declared.filter((s, i) => declared.indexOf(s) !== i);
  if (dupStages.length) globIssue(['stages'], { id: 'stages-duplicate', severity: 'warning', title: `Этап объявлен дважды: ${[...new Set(dupStages)].join(', ')}`, how: 'GitLab оставит только первое упоминание; порядок этапов может оказаться не тем, что ожидается.', why: 'Каждый этап должен встречаться в stages один раз.', fix: 'Удалите повтор.' });
  if (declared.some((s) => s === '.pre' || s === '.post')) globIssue(['stages'], { id: 'stages-pre-post', severity: 'info', title: '.pre и .post в stages указывать не нужно', how: 'Ничего не сломается: эти этапы есть всегда и всегда идут первым и последним.', why: 'Их позиция фиксирована, указанный порядок игнорируется.', fix: 'Уберите .pre / .post из stages.' });

  /* ---------- Разбор заданий ---------- */
  const resolved = new Map(); // имя → итоговая конфигурация
  for (const name of raw.jobs.keys()) {
    const r = raw.resolveJob(name);
    resolved.set(name, raw.resolveReferences(r?.config ?? raw.jobs.get(name).config));
  }
  const stageOf = (name) => String(resolved.get(name)?.stage ?? 'test');
  const stageIndex = (name) => {
    const i = stageNames.indexOf(stageOf(name));
    return i < 0 ? stageNames.length - 1 : i;
  };
  const usedStages = new Set();
  const onlyJobs = [];
  const tagSets = new Map();
  let dindAt = null;
  const yamlVars = new Set(Object.keys(isObj(globals.variables) ? globals.variables : {}));
  for (const name of visible) for (const k of Object.keys(isObj(resolved.get(name).variables) ? resolved.get(name).variables : {})) yamlVars.add(k);

  for (const name of visible) {
    const cfg = resolved.get(name);
    const own = raw.jobs.get(name).config;
    const ji = (keyPath, o) => jobIssue(name, keyPath, o);

    if (name.length > 255) ji([], { id: 'job-name-long', severity: 'error', title: 'Слишком длинное имя задания', how: rejected('job name is too long (maximum is 255 characters)'), why: 'Имя задания ограничено 255 символами.', fix: 'Сократите имя.' });

    // Неизвестные ключи
    for (const k of Object.keys(cfg)) {
      if (JOB_KEYS.includes(k)) continue;
      const near = suggest(k, JOB_KEYS);
      ji([k], {
        id: 'job-unknown-key',
        severity: 'error',
        title: `${q(name)}: неизвестный ключ ${q(k)}${near ? ` — опечатка в ${q(near)}?` : ''}`,
        how: rejected(`jobs:${name} config contains unknown keys: ${k}`),
        why: near ? `GitLab не знает ключа ${q(k)}; ближайший допустимый — ${q(near)}.` : `GitLab проверяет все ключи задания; ${q(k)} среди них нет.${k in own ? '' : ' Ключ пришёл из шаблона в extends.'}`,
        fix: near ? `Переименуйте ${q(k)} в ${q(near)}.` : 'Удалите ключ или вынесите данные в variables.',
      });
    }

    // script / trigger / run
    const hasScript = cfg.script !== undefined;
    const hasTrigger = cfg.trigger !== undefined;
    const hasRun = cfg.run !== undefined;
    if (!hasScript && !hasTrigger && !hasRun) {
      const near = suggest(name, GLOBAL_KEYS);
      ji([], {
        id: near ? 'global-typo' : 'job-no-script',
        severity: 'error',
        title: near ? `${q(name)} — опечатка в ${q(near)}?` : `${q(name)}: нет script`,
        how: rejected(`jobs:${name} config should implement the script:, run:, or trigger: keyword`),
        why: near
          ? `Раздел ${q(name)} не служебный, поэтому GitLab считает его заданием, а у задания нет script.`
          : `У задания нет команд для выполнения${cfg.extends || chainOf(name).length ? ' — и шаблоны в extends их не добавляют' : ''}.`,
        fix: near ? `Переименуйте в ${q(near)}.` : `Добавьте script, например:\n${name}:\n  script:\n    - echo "…"`,
      });
    }
    if (hasScript && hasTrigger) ji(['trigger'], { id: 'trigger-with-script', severity: 'error', title: `${q(name)}: trigger и script одновременно`, how: rejected(`jobs:${name} config key may not be used with \`trigger\`: script`), why: 'Задание с trigger само ничего не выполняет — оно запускает другой пайплайн.', fix: 'Разделите на два задания: одно со script, другое с trigger.' });
    if (hasScript) {
      const s = cfg.script;
      const lines = arr(s).flat(10);
      if (s === null || s === '' || (Array.isArray(s) && lines.length === 0)) {
        ji(['script'], { id: 'script-empty', severity: 'error', title: `${q(name)}: пустой script`, how: rejected(`jobs:${name}:script config can't be blank`), why: 'В script должна быть хотя бы одна команда.', fix: 'Добавьте команду или удалите задание.' });
      }
      for (const key of ['script', 'before_script', 'after_script']) {
        arr(cfg[key]).flat(10).forEach((item, i) => {
          if (isObj(item) && !item.__reference) {
            const k = Object.keys(item)[0];
            ji([key, i], {
              id: 'script-colon',
              severity: 'error',
              title: `${q(name)}: строка ${key} прочитана как «ключ: значение»`,
              how: rejected(`jobs:${name}:${key} config should be a string or a nested array of strings up to 10 levels deep`),
              why: `В строке ${q(`${k}: ${item[k]}`)} есть «: » — YAML считает это картой, а не командой.`,
              fix: `Возьмите строку в кавычки: - '${k}: ${item[k]}'`,
            });
          } else if (typeof item === 'boolean' || typeof item === 'number') {
            ji([key, i], { id: 'script-scalar', severity: 'warning', title: `${q(name)}: в ${key} значение ${item}`, how: `Выполнится команда ${q(String(item))} — скорее всего «command not found».`, why: 'YAML прочитал строку как число/логическое значение.', fix: 'Проверьте строку и возьмите её в кавычки.' });
          }
        });
      }
    }

    // Этап
    const stage = stageOf(name);
    usedStages.add(stage);
    if (cfg.stage !== undefined && typeof cfg.stage !== 'string') ji(['stage'], { id: 'stage-type', severity: 'error', title: `${q(name)}: stage должен быть строкой`, how: rejected(`jobs:${name}:stage config should be a string`), why: 'Задание относится к одному этапу.', fix: 'stage: test' });
    else if (!stageNames.includes(stage)) {
      const near = suggest(stage, stageNames);
      ji(['stage'], {
        id: 'stage-undeclared',
        severity: 'error',
        title: `${q(name)}: этапа ${q(stage)} нет в stages`,
        how: rejected(`${name} job: chosen stage ${stage} does not exist; available stages are ${stageNames.join(', ')}`),
        why: declared.length ? `Объявлены этапы: ${declared.join(', ')}.${near ? ` Возможно, имелось в виду ${q(near)}.` : ''}` : `stages не объявлен, поэтому доступны только build, test, deploy (+ .pre, .post).${near ? ` Возможно, ${q(near)}.` : ''}`,
        fix: near ? `Исправьте на stage: ${near} или добавьте ${q(stage)} в stages.` : `Добавьте ${q(stage)} в stages.`,
      });
    }

    // when / start_in
    if (cfg.when !== undefined && !JOB_WHEN.includes(cfg.when)) {
      ji(['when'], { id: 'when-invalid', severity: 'error', title: `${q(name)}: when: ${cfg.when}`, how: rejected(`jobs:${name} when should be one of: ${JOB_WHEN.filter((w) => w !== 'never').join(', ')}`), why: `Неизвестное значение.${didYouMean(cfg.when, JOB_WHEN)}`, fix: `Используйте одно из: ${JOB_WHEN.join(', ')}.` });
    }
    if (cfg.when === 'never') ji(['when'], { id: 'when-never', severity: 'warning', title: `${q(name)}: when: never — задание никогда не запустится`, how: 'Задания не будет ни в одном пайплайне.', why: 'when: never на уровне задания отключает его полностью (обычно never пишут внутри rules).', fix: 'Удалите задание или перенесите условие в rules.' });
    if (cfg.when === 'delayed' && cfg.start_in === undefined) ji(['when'], { id: 'delayed-no-start', severity: 'error', title: `${q(name)}: when: delayed без start_in`, how: rejected(`jobs:${name} start in should be specified for delayed job`), why: 'Отложенному заданию нужно знать, через сколько стартовать.', fix: 'start_in: 30 minutes' });
    if (cfg.start_in !== undefined && cfg.when !== 'delayed' && !arr(cfg.rules).some((r) => r?.when === 'delayed')) ji(['start_in'], { id: 'start-in-not-delayed', severity: 'error', title: `${q(name)}: start_in без when: delayed`, how: rejected(`jobs:${name} start in must be blank when not delayed`), why: 'start_in имеет смысл только для отложенных заданий.', fix: 'Добавьте when: delayed или уберите start_in.' });
    if (cfg.start_in !== undefined) {
      const sec = durationSeconds(cfg.start_in);
      if (sec == null) ji(['start_in'], { id: 'start-in-format', severity: 'error', title: `${q(name)}: не разобрать start_in: ${cfg.start_in}`, how: rejected(`jobs:${name}:start_in config should be a duration`), why: 'Длительность пишется как «30 minutes», «1 hour», «2 days».', fix: 'start_in: 30 minutes' });
      else if (sec > 7 * 86400) ji(['start_in'], { id: 'start-in-limit', severity: 'error', title: `${q(name)}: start_in больше недели`, how: rejected(`jobs:${name} start in should not exceed the limit`), why: 'Максимальная задержка — 1 неделя.', fix: 'Уменьшите start_in или используйте расписание.' });
    }

    // rules / only / except
    if (cfg.rules !== undefined) {
      checkRules(cfg.rules, { at: (kp) => locate(name, ['rules', ...kp]), who: q(name), job: name, cfg });
      for (const k of ['only', 'except']) {
        if (cfg[k] !== undefined) ji([k], { id: 'rules-with-only', severity: 'error', title: `${q(name)}: rules вместе с ${k}`, how: rejected(`jobs:${name} config key may not be used with \`rules\`: ${k}`), why: `rules заменяет ${k}; вместе их использовать нельзя${k in own ? '' : ` (${k} пришёл из шаблона)`}.`, fix: `Перенесите условие из ${k} в rules.` });
      }
    }
    for (const k of ['only', 'except']) if (cfg[k] !== undefined && cfg.rules === undefined) checkOnly(name, k, cfg[k]);

    // needs
    if (cfg.needs !== undefined) {
      const needs = arr(cfg.needs);
      if (needs.length > 50) ji(['needs'], { id: 'needs-limit', severity: 'error', title: `${q(name)}: needs больше 50`, how: rejected(`${name} job: one job can only need 50 others`), why: 'Ограничение GitLab.', fix: 'Сократите список или объедините задания.' });
      needs.forEach((n, i) => {
        const target = typeof n === 'string' ? n : n?.job;
        if (isObj(n) && (n.pipeline || n.project)) return;
        if (target == null) {
          ji(['needs', i], { id: 'needs-format', severity: 'error', title: `${q(name)}: в needs запись без job`, how: rejected(`jobs:${name}:needs config contains unknown keys`), why: 'Каждая запись needs — имя задания или { job: имя }.', fix: 'needs:\n  - job: build\n    artifacts: true' });
          return;
        }
        const optional = isObj(n) && n.optional === true;
        if (target === name) ji(['needs', i], { id: 'needs-self', severity: 'error', title: `${q(name)} зависит само от себя`, how: rejected(`${name} job: needs itself (circular dependency)`), why: 'Задание не может ждать завершения самого себя.', fix: 'Уберите себя из needs.' });
        else if (!raw.jobs.has(target) || String(target).startsWith('.')) {
          if (!optional) {
            ji(['needs', i], {
              id: 'needs-unknown',
              severity: offline.length && !raw.jobs.has(target) ? 'warning' : 'error',
              title: `${q(name)}: needs на несуществующее ${q(target)}`,
              how: rejected(`'${name}' job needs '${target}' job, but '${target}' does not exist in the pipeline. This might be because of the only, except, or rules keywords. To need a job that sometimes does not exist in the pipeline, use needs:optional.`),
              why: String(target).startsWith('.') ? `${q(target)} — скрытое задание (шаблон), оно не выполняется и не может быть в needs.` : `Задания ${q(target)} нет.${didYouMean(target, visible)}`,
              fix: 'Исправьте имя или добавьте optional: true.',
            });
          }
        } else if (stageIndex(target) > stageIndex(name)) {
          ji(['needs', i], { id: 'needs-later-stage', severity: 'error', title: `${q(name)} ждёт ${q(target)} из более позднего этапа`, how: rejected(`${name} job: need ${target} is not defined in current or prior stages`), why: `${q(target)} в этапе ${q(stageOf(target))}, который идёт после ${q(stage)}.`, fix: `Перенесите ${q(name)} в этап не раньше ${q(stageOf(target))} или ${q(target)} — раньше.` });
        }
        if (isObj(n)) {
          for (const k of Object.keys(n)) if (!['job', 'artifacts', 'optional', 'pipeline', 'project', 'ref', 'parallel'].includes(k)) ji(['needs', i, k], { id: 'needs-unknown-key', severity: 'error', title: `${q(name)}: needs — неизвестный ключ ${q(k)}`, how: rejected(`jobs:${name}:needs:need config contains unknown keys: ${k}`), why: `Допустимы: job, artifacts, optional, pipeline, project, ref, parallel.${didYouMean(k, ['job', 'artifacts', 'optional'])}`, fix: 'Уберите ключ.' });
        }
      });
    }

    // dependencies
    if (cfg.dependencies !== undefined) {
      const needNames = cfg.needs === undefined ? null : arr(cfg.needs).map((n) => (typeof n === 'string' ? n : n?.job));
      arr(cfg.dependencies).forEach((dep, i) => {
        if (!raw.jobs.has(dep) || String(dep).startsWith('.')) ji(['dependencies', i], { id: 'dependencies-unknown', severity: 'error', title: `${q(name)}: dependencies на несуществующее ${q(dep)}`, how: rejected(`${name} job: undefined dependency: ${dep}`), why: `Задания ${q(dep)} нет.${didYouMean(dep, visible)}`, fix: 'Поправьте имя.' });
        else if (needNames && !needNames.includes(dep)) ji(['dependencies', i], { id: 'dependencies-not-in-needs', severity: 'error', title: `${q(name)}: ${q(dep)} в dependencies, но не в needs`, how: rejected(`${name} job: dependencies the ${dep} should be part of needs`), why: 'Когда задан needs, dependencies может ссылаться только на задания из needs.', fix: `Добавьте ${q(dep)} в needs.` });
        else if (!needNames && stageIndex(dep) >= stageIndex(name)) ji(['dependencies', i], { id: 'dependencies-later-stage', severity: 'error', title: `${q(name)}: ${q(dep)} не из предыдущего этапа`, how: rejected(`${name} job: dependency ${dep} is not defined in current or prior stages`), why: `Артефакты можно брать только у заданий из предыдущих этапов, а ${q(dep)} — в этапе ${q(stageOf(dep))}.`, fix: 'Перенесите задание или используйте needs.' });
      });
    }

    // variables
    checkVariables(cfg.variables, (kp) => locate(name, ['variables', ...kp]), `jobs:${name}:variables`, name);

    // image / services
    if (cfg.image !== undefined) checkImage(cfg.image, name, ['image']);
    for (const [i, svc] of arr(cfg.services ?? defaults.services ?? globals.services).entries()) {
      const svcName = typeof svc === 'string' ? svc : svc?.name;
      if (!svcName) ji(['services', i], { id: 'service-no-name', severity: 'error', title: `${q(name)}: у сервиса нет name`, how: rejected(`jobs:${name}:services:service config must have a name`), why: 'Сервис — это образ Docker.', fix: 'services:\n  - name: postgres:16\n    alias: db' });
      else checkImageName(svcName, name, ['services', i], 'сервис');
      if (isObj(svc) && svc.alias && !/^[a-z0-9][a-z0-9.,-]*$/i.test(String(svc.alias))) ji(['services', i, 'alias'], { id: 'service-alias', severity: 'error', title: `${q(name)}: недопустимый alias сервиса ${q(svc.alias)}`, how: 'Задание упадёт при запуске сервиса: имя хоста недопустимо.', why: 'alias становится именем хоста: только буквы, цифры, точка, дефис.', fix: 'Например alias: db' });
    }
    if (!dindAt && arr(cfg.services ?? defaults.services).some((s) => /docker.*dind/i.test(typeof s === 'string' ? s : s?.name ?? ''))) dindAt = { ...locate(name, ['services']), job: name };

    // artifacts
    if (cfg.artifacts !== undefined) checkArtifacts(name, cfg.artifacts);
    // cache
    if (cfg.cache !== undefined) checkCache(name, cfg.cache, cfg.cache === own.cache || 'cache' in own ? ['cache'] : ['cache']);

    // Ограничения
    if (cfg.parallel !== undefined) {
      const p = cfg.parallel;
      if (typeof p === 'number') {
        if (!Number.isInteger(p) || p < 1 || p > 200) ji(['parallel'], { id: 'parallel-range', severity: 'error', title: `${q(name)}: parallel: ${p}`, how: rejected(`jobs:${name}:parallel config must be ${p > 200 ? 'less than or equal to 200' : 'greater than or equal to 1'}`), why: 'parallel — целое число от 1 до 200.', fix: 'parallel: 5' });
      } else if (isObj(p) && p.matrix !== undefined) {
        const matrix = arr(p.matrix);
        let total = 0;
        matrix.forEach((m, i) => {
          if (!isObj(m)) {
            ji(['parallel', 'matrix', i], { id: 'matrix-format', severity: 'error', title: `${q(name)}: запись parallel:matrix не карта`, how: rejected(`jobs:${name}:parallel:matrix config should be an array of hashes`), why: 'Каждая запись матрицы — набор «ПЕРЕМЕННАЯ: [значения]».', fix: 'parallel:\n  matrix:\n    - NODE: ["18", "20"]' });
            return;
          }
          total += Object.values(m).reduce((n, v) => n * Math.max(1, arr(v).length), 1);
          for (const [k, v] of Object.entries(m)) if (arr(v).some((x) => isObj(x) || Array.isArray(x))) ji(['parallel', 'matrix', i, k], { id: 'matrix-value', severity: 'error', title: `${q(name)}: в матрице ${k} — вложенная структура`, how: rejected(`jobs:${name}:parallel:matrix config should be an array of hashes with arrays of strings`), why: 'Значения матрицы — строки или числа.', fix: 'Перечислите значения списком строк.' });
        });
        if (total > 200) ji(['parallel', 'matrix'], { id: 'matrix-limit', severity: 'error', title: `${q(name)}: матрица даёт ${total} заданий`, how: rejected(`jobs:${name}:parallel:matrix config generates too many jobs (maximum is 200)`), why: 'Не более 200 комбинаций на задание.', fix: 'Сократите число значений.' });
      } else ji(['parallel'], { id: 'parallel-format', severity: 'error', title: `${q(name)}: непонятный parallel`, how: rejected(`jobs:${name}:parallel config should be an integer or a hash`), why: 'parallel — число или { matrix: [...] }.', fix: 'parallel: 3' });
    }
    if (cfg.retry !== undefined) {
      const r = cfg.retry;
      const max = isObj(r) ? r.max : r;
      if (max !== undefined && (!Number.isInteger(max) || max < 0 || max > 2)) ji(['retry'], { id: 'retry-range', severity: 'error', title: `${q(name)}: retry ${max}`, how: rejected(`jobs:${name}:retry config must be between 0 and 2`), why: 'GitLab повторяет задание не более 2 раз.', fix: 'retry: 2' });
      if (isObj(r)) {
        for (const w of arr(r.when)) if (!RETRY_WHEN.includes(w)) ji(['retry', 'when'], { id: 'retry-when', severity: 'error', title: `${q(name)}: retry:when ${q(w)}`, how: rejected(`jobs:${name}:retry when unknown value: ${w}`), why: `Неизвестная причина повтора.${didYouMean(w, RETRY_WHEN)}`, fix: `Допустимы: ${RETRY_WHEN.slice(0, 6).join(', ')}…` });
        for (const k of Object.keys(r)) if (!['max', 'when', 'exit_codes'].includes(k)) ji(['retry', k], { id: 'retry-key', severity: 'error', title: `${q(name)}: retry — неизвестный ключ ${q(k)}`, how: rejected(`jobs:${name}:retry config contains unknown keys: ${k}`), why: 'Допустимы max, when, exit_codes.', fix: 'Уберите ключ.' });
      }
    }
    if (cfg.timeout !== undefined) {
      const sec = durationSeconds(cfg.timeout);
      if (sec == null) ji(['timeout'], { id: 'timeout-format', severity: 'error', title: `${q(name)}: не разобрать timeout: ${cfg.timeout}`, how: rejected(`jobs:${name}:timeout config should be a duration`), why: 'Длительность пишется как «1h 30m», «90 minutes».', fix: 'timeout: 1h 30m' });
      else if (sec > 30 * 86400) ji(['timeout'], { id: 'timeout-limit', severity: 'error', title: `${q(name)}: timeout больше месяца`, how: rejected(`jobs:${name}:timeout config should not exceed the limit`), why: 'Максимум — 1 месяц.', fix: 'Уменьшите timeout.' });
    }
    if (cfg.allow_failure !== undefined && typeof cfg.allow_failure !== 'boolean') {
      const ok = isObj(cfg.allow_failure) && Object.keys(cfg.allow_failure).every((k) => k === 'exit_codes') && arr(cfg.allow_failure.exit_codes).every(Number.isInteger);
      if (!ok) ji(['allow_failure'], { id: 'allow-failure-format', severity: 'error', title: `${q(name)}: allow_failure: ${JSON.stringify(cfg.allow_failure)}`, how: rejected(`jobs:${name}:allow_failure config should be a hash or a boolean value`), why: 'allow_failure — true/false или { exit_codes: [коды] }.', fix: 'allow_failure: true' });
    }
    if (cfg.coverage !== undefined) {
      const m = /^\/(.+)\/([a-z]*)$/.exec(String(cfg.coverage));
      if (!m) ji(['coverage'], { id: 'coverage-format', severity: 'error', title: `${q(name)}: coverage не регулярное выражение`, how: rejected(`jobs:${name}:coverage config must be a regular expression`), why: 'coverage пишется между слэшами.', fix: "coverage: '/Lines:\\s+(\\d+\\.?\\d*)%/'" });
      else {
        try {
          new RegExp(m[1]);
        } catch (e) {
          ji(['coverage'], { id: 'coverage-regex', severity: 'error', title: `${q(name)}: ошибка в регулярке coverage`, how: rejected(`jobs:${name}:coverage config must be a regular expression`), why: e.message, fix: 'Исправьте выражение.' });
        }
      }
    }
    if (cfg.interruptible !== undefined && typeof cfg.interruptible !== 'boolean') ji(['interruptible'], { id: 'interruptible-type', severity: 'error', title: `${q(name)}: interruptible должен быть true/false`, how: rejected(`jobs:${name} interruptible should be a boolean value`), why: `Сейчас: ${JSON.stringify(cfg.interruptible)}.`, fix: 'interruptible: true' });
    if (cfg.tags !== undefined) {
      if (!Array.isArray(cfg.tags) || cfg.tags.some((t) => typeof t !== 'string' && typeof t !== 'number')) ji(['tags'], { id: 'tags-type', severity: 'error', title: `${q(name)}: tags должен быть списком строк`, how: rejected(`jobs:${name}:tags config should be an array of strings`), why: 'Теги перечисляются списком.', fix: 'tags:\n  - docker' });
      else if (cfg.tags.length) {
        const key = cfg.tags.join(', ');
        if (!tagSets.has(key)) tagSets.set(key, { jobs: [], ...locate(name, ['tags']) });
        tagSets.get(key).jobs.push(name);
      }
    }
    if (cfg.inherit !== undefined) {
      if (!isObj(cfg.inherit)) ji(['inherit'], { id: 'inherit-type', severity: 'error', title: `${q(name)}: inherit должен быть картой`, how: rejected(`jobs:${name}:inherit config should be a hash`), why: 'inherit: { default: …, variables: … }.', fix: 'inherit:\n  default: false' });
      else for (const k of Object.keys(cfg.inherit)) if (!['default', 'variables'].includes(k)) ji(['inherit', k], { id: 'inherit-key', severity: 'error', title: `${q(name)}: inherit — неизвестный ключ ${q(k)}`, how: rejected(`jobs:${name}:inherit config contains unknown keys: ${k}`), why: 'Допустимы default и variables.', fix: 'Уберите ключ.' });
    }

    // environment
    if (cfg.environment !== undefined) checkEnvironment(name, cfg.environment);

    // trigger
    if (hasTrigger) {
      const t = cfg.trigger;
      if (isObj(t)) {
        if (t.project && t.include) ji(['trigger'], { id: 'trigger-both', severity: 'error', title: `${q(name)}: trigger с project и include одновременно`, how: rejected(`jobs:${name}:trigger config contains unknown keys`), why: 'Либо дочерний пайплайн (include), либо пайплайн другого проекта (project).', fix: 'Оставьте одно.' });
        if (t.strategy !== undefined && !['depend', 'mirror'].includes(t.strategy)) ji(['trigger', 'strategy'], { id: 'trigger-strategy', severity: 'error', title: `${q(name)}: trigger:strategy ${t.strategy}`, how: rejected(`jobs:${name}:trigger:strategy should be one of: depend, mirror`), why: 'Допустимы depend и mirror.', fix: 'strategy: depend' });
        for (const inc of arr(t.include)) {
          const local = typeof inc === 'string' ? inc : inc?.local;
          if (local && !/\$/.test(local) && !repo.hasFile(local) && !result.files.some((f) => f.path === local.replace(/^\//, ''))) {
            ji(['trigger', 'include'], { id: 'trigger-include-missing', severity: 'error', title: `${q(name)}: дочерний пайплайн ${local} не найден`, when: `Когда дойдёт очередь до задания ${q(name)}`, how: `Дочерний пайплайн не создастся, задание ${q(name)} упадёт: «Included file \`${local}\` is empty or does not exist!».`, why: 'Файла нет в репозитории.', fix: 'Проверьте путь от корня репозитория.' });
          }
        }
      }
    }

    // pages
    if (name === 'pages' || cfg.pages !== undefined) {
      const publish = cfg.pages?.publish ?? cfg.publish ?? 'public';
      const paths = arr(cfg.artifacts?.paths).map(String);
      if (!paths.some((p) => p.replace(/\/+$/, '') === String(publish).replace(/\/+$/, ''))) {
        ji(paths.length ? ['artifacts', 'paths'] : [], { id: 'pages-no-public', severity: 'warning', title: `${q(name)}: в артефактах нет папки ${publish}`, when: `После задания ${q(name)}`, how: `Сайт не опубликуется: задание pages:deploy упадёт — «pages:deploy … The ${publish} folder is missing from the artifacts».`, why: `GitLab Pages публикует содержимое папки ${q(publish)} из артефактов задания.`, fix: `artifacts:\n  paths:\n    - ${publish}` });
      }
    }
    // release
    if (cfg.release !== undefined) {
      const rel = cfg.release;
      if (!isObj(rel) || !rel.tag_name) ji(['release'], { id: 'release-no-tag', severity: 'error', title: `${q(name)}: release без tag_name`, how: rejected(`jobs:${name}:release tag name can't be blank`), why: 'Релиз привязан к тегу.', fix: 'release:\n  tag_name: $CI_COMMIT_TAG\n  description: "…"' });
      if (isObj(rel) && !rel.description) ji(['release'], { id: 'release-no-description', severity: 'error', title: `${q(name)}: release без description`, how: rejected(`jobs:${name}:release description can't be blank`), why: 'Описание релиза обязательно.', fix: 'description: "Релиз $CI_COMMIT_TAG"' });
      const img = String(typeof cfg.image === 'string' ? cfg.image : cfg.image?.name ?? '');
      if (!/release-cli|glab|cli/.test(img)) ji(['release'], { id: 'release-image', severity: 'warning', title: `${q(name)}: release в образе без release-cli`, when: `При выполнении задания ${q(name)}`, how: 'Задание упадёт: «release-cli: command not found» (или «glab: not found»).', why: 'Ключ release выполняется утилитой release-cli / glab, которой нет в обычных образах.', fix: 'image: registry.gitlab.com/gitlab-org/release-cli:latest' });
    }
  }
  for (const s of declared) {
    if (!usedStages.has(s) && s !== '.pre' && s !== '.post') globIssue(['stages'], { id: 'stage-unused', severity: 'info', title: `Этап ${q(s)} объявлен, но в нём нет заданий`, how: 'Ничего не сломается — пустой этап просто не показывается.', why: 'Ни одно задание не указывает stage: ' + s + '.', fix: 'Уберите этап или проверьте stage у заданий (опечатка?).' });
  }
  checkVariables(globals.variables, (kp) => globalLoc(['variables', ...kp]), 'variables', null);
  if (defaults.image !== undefined) checkImage(defaults.image, null, ['default', 'image']);
  else if (globals.image !== undefined) checkImage(globals.image, null, ['image']);
  if (onlyJobs.length) {
    add({ id: 'only-deprecated', severity: 'info', title: `only/except устарели (${onlyJobs.length} задан.)`, when: CONFIG_WHEN, how: 'Сейчас работает, но новые возможности (needs, variables, changes:compare_to в правилах) доступны только через rules.', why: `only/except больше не развиваются. Используются в: ${onlyJobs.map((o) => q(o.name)).slice(0, 6).join(', ')}${onlyJobs.length > 6 ? '…' : ''}.`, fix: 'Например, only: [main] →\nrules:\n  - if: $CI_COMMIT_BRANCH == "main"', file: onlyJobs[0].file, line: onlyJobs[0].line, job: onlyJobs[0].name });
  }
  for (const [tags, t] of tagSets) {
    add({ id: 'tags-runner', severity: 'info', title: `Нужен раннер с тегами: ${tags}`, when: `При запуске заданий ${t.jobs.map(q).slice(0, 4).join(', ')}${t.jobs.length > 4 ? '…' : ''}`, how: 'Если такого раннера нет, задание повиснет в pending: «This job is stuck because you don’t have any active runners online … with any of these tags assigned to them».', why: 'Задание берёт только раннер, у которого есть все перечисленные теги.', fix: 'Проверьте Settings → CI/CD → Runners.', file: t.file, line: t.line, job: t.jobs[0] });
  }
  if (dindAt) add({ id: 'dind-privileged', severity: 'info', title: 'docker:dind требует privileged-раннер', when: `При выполнении задания ${q(dindAt.job)}`, how: 'На раннере без privileged = true сервис не стартует: «mount: permission denied» / «Cannot connect to the Docker daemon».', why: 'Docker-in-Docker запускает свой демон внутри контейнера, а это нужно разрешить в настройках раннера.', fix: 'Проверьте, что у раннера privileged = true (config.toml), или используйте kaniko/buildah.', ...dindAt });

  // Циклы needs
  const needsOf = (n) => arr(resolved.get(n)?.needs).map((x) => (typeof x === 'string' ? x : x?.job)).filter((x) => x && visible.includes(x) && x !== n);
  const cycleSeen = new Set();
  for (const start of visible) {
    const stack = [];
    const dfs = (n) => {
      if (stack.includes(n)) return [...stack.slice(stack.indexOf(n)), n];
      stack.push(n);
      for (const d of needsOf(n)) {
        const c = dfs(d);
        if (c) return c;
      }
      stack.pop();
      return null;
    };
    const cycle = dfs(start);
    if (cycle) {
      const key = [...new Set(cycle)].sort().join('|');
      if (!cycleSeen.has(key)) {
        cycleSeen.add(key);
        jobIssue(cycle[0], ['needs'], { id: 'needs-cycle', severity: 'error', title: `Задания ждут друг друга по кругу: ${cycle.join(' → ')}`, how: rejected('circular dependency detected in `needs`'), why: 'Ни одно из заданий не может стартовать первым.', fix: 'Уберите одну из зависимостей.' });
      }
    }
  }

  /* ---------- Скрипты ---------- */
  const scriptJobs = visible.map((name) => {
    const cfg = resolved.get(name);
    const inheritDefault = cfg.inherit?.default !== false;
    const linesFor = (key) => {
      let value;
      let file;
      let prefix;
      if (cfg[key] !== undefined) {
        value = cfg[key];
        file = locate(name, [key]).file;
        prefix = [locateJobKeyPrefix(name, key)?.[0] ?? name, key];
      } else if (inheritDefault && defaults[key] !== undefined) {
        value = defaults[key];
        file = globalLoc(['default', key]).file;
        prefix = ['default', key];
      } else if (inheritDefault && globals[key] !== undefined) {
        value = globals[key];
        file = globalLoc([key]).file;
        prefix = [key];
      } else return [];
      return arr(value)
        .flat(10)
        .filter((x) => typeof x === 'string')
        .map((text, i) => ({ text, file, line: L(file, [...prefix, i]) ?? L(file, prefix) }));
    };
    const artifactsFrom = [];
    const needs = cfg.needs === undefined ? null : arr(cfg.needs).filter((n) => !(isObj(n) && n.artifacts === false)).map((n) => (typeof n === 'string' ? n : n?.job));
    const deps = cfg.dependencies !== undefined ? arr(cfg.dependencies) : needs ?? visible.filter((o) => stageIndex(o) < stageIndex(name));
    for (const d of deps) for (const p of arr(resolved.get(d)?.artifacts?.paths)) artifactsFrom.push(String(p).replace(/\/\*\*?$/, ''));
    for (const c of arr(cfg.cache ?? defaults.cache)) for (const p of arr(c?.paths)) artifactsFrom.push(String(p).replace(/\/\*\*?$/, ''));
    const vars = new Set([...yamlVars]);
    const before = linesFor('before_script');
    const script = linesFor('script');
    const loc = locate(name, ['script']);
    const img = cfg.image ?? (inheritDefault ? defaults.image ?? globals.image : undefined);
    return {
      name,
      file: loc.file,
      line: loc.line,
      lines: [...before, ...script].map((l) => ({ ...l })),
      image: typeof img === 'string' ? img : img?.name,
      services: arr(cfg.services ?? (inheritDefault ? defaults.services ?? globals.services : undefined)).map((s) => (typeof s === 'string' ? s : s?.name ?? '')),
      vars,
      artifactsFrom,
      system: 'gitlab',
    };
  });
  checkScripts(scriptJobs, repo, (issue) => add({ ...issue, file: issue.file, line: issue.line }), { system: 'gitlab' });
  // Неизвестные предопределённые переменные в скриптах
  for (const j of scriptJobs) {
    for (const ln of j.lines) {
      for (const m of ln.text.matchAll(/\$\{?((?:CI|GITLAB)_[A-Z0-9_]+)/g)) checkVarName(m[1], { file: ln.file ?? j.file, line: ln.line, job: j.name }, 'script');
    }
  }

  /* ---------- Сценарии ---------- */
  const scenarios = simulate();

  return { scenarios };

  /* =================== Вспомогательные проверки =================== */

  function locateJobKeyPrefix(name, key) {
    for (const n of [name, ...chainOf(name)]) if (raw.jobs.get(n)?.config?.[key] !== undefined) return [n];
    return null;
  }

  function checkVarName(v, at, where) {
    if (PREDEFINED.has(v) || yamlVars.has(v)) return;
    if (OLD_VARS[v]) {
      add({ id: 'var-removed', severity: 'error', title: `$${v} больше не существует`, when: where === 'script' ? `При выполнении задания ${q(at.job)}` : CONFIG_WHEN, how: `Переменная будет пустой: ${where === 'script' ? 'команда получит пустую строку' : 'условие никогда не сработает так, как задумано'}.`, why: `Переменные CI_BUILD_* удалены в GitLab 9.0; теперь это $${OLD_VARS[v]}.`, fix: `Замените на $${OLD_VARS[v]}.`, ...at });
      return;
    }
    const near = suggest(v, [...PREDEFINED]);
    add({
      id: 'var-unknown-predefined',
      severity: near ? 'warning' : 'info',
      title: `$${v} — нет такой предопределённой переменной`,
      when: where === 'script' ? `При выполнении задания ${q(at.job)}` : CONFIG_WHEN,
      how: where === 'script' ? 'Ошибки не будет, но на месте переменной окажется пустая строка.' : 'Ошибки не будет, но переменная всегда пустая — условие будет вести себя так, будто её нет.',
      why: near ? `Похоже на опечатку: есть $${near}.` : 'Имена с CI_ / GITLAB_ зарезервированы GitLab, а такой среди них нет (если это переменная из настроек проекта — всё в порядке).',
      fix: near ? `Замените на $${near}.` : 'Проверьте имя.',
      ...at,
    });
  }

  function checkRules(rules, { workflow = false, at, who, job, cfg } = {}) {
    const where = workflow ? 'workflow:rules' : `jobs:${job}:rules`;
    if (!Array.isArray(rules)) {
      add({ id: 'rules-not-list', severity: 'error', title: `${who}: rules должен быть списком`, when: CONFIG_WHEN, how: rejected(`${where} config should be an array of hashes`), why: 'Каждое правило — отдельный элемент списка, начинается с «- ».', fix: 'rules:\n  - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH', ...at([]), job });
      return;
    }
    const keys = workflow ? WORKFLOW_RULE_KEYS : RULE_KEYS;
    const allowedWhen = workflow ? ['always', 'never'] : RULE_WHEN;
    let catchAll = -1;
    rules.forEach((rule, i) => {
      if (Array.isArray(rule)) return; // вложенный !reference — уже раскрыт
      if (!isObj(rule)) {
        add({ id: 'rule-not-hash', severity: 'error', title: `${who}: правило ${i + 1} — не карта`, when: CONFIG_WHEN, how: rejected(`${where}:rule config should be a hash`), why: `Сейчас правило — ${typeof rule === 'string' ? `строка ${q(rule)}` : JSON.stringify(rule)}.`, fix: typeof rule === 'string' ? `- if: ${rule}` : '- if: …', ...at([i]), job });
        return;
      }
      for (const k of Object.keys(rule)) {
        if (!keys.includes(k)) add({ id: 'rule-unknown-key', severity: 'error', title: `${who}: в правиле ${i + 1} неизвестный ключ ${q(k)}`, when: CONFIG_WHEN, how: rejected(`${where}:rule config contains unknown keys: ${k}`), why: `Допустимы: ${keys.join(', ')}.${didYouMean(k, keys)}${workflow && ['allow_failure', 'needs', 'start_in'].includes(k) ? ` ${q(k)} работает только в rules заданий.` : ''}`, fix: 'Исправьте или уберите ключ.', ...at([i, k]), job });
      }
      if (rule.when !== undefined && !allowedWhen.includes(rule.when)) {
        add({ id: 'rule-when', severity: 'error', title: `${who}: правило ${i + 1}: when: ${rule.when}`, when: CONFIG_WHEN, how: rejected(`${where}:rule when unknown value: ${rule.when}`), why: workflow ? 'В workflow:rules допустимы только always и never.' : `Допустимы: ${RULE_WHEN.join(', ')}.${didYouMean(rule.when, RULE_WHEN)}`, fix: workflow ? 'when: always' : 'when: on_success', ...at([i, 'when']), job });
      }
      if (rule.when === 'delayed' && rule.start_in === undefined && cfg?.start_in === undefined) add({ id: 'rule-delayed', severity: 'error', title: `${who}: правило ${i + 1}: delayed без start_in`, when: CONFIG_WHEN, how: rejected(`${where}:rule start in should be specified for delayed job`), why: 'Нужно указать задержку.', fix: 'start_in: 10 minutes', ...at([i]), job });
      if (rule.if !== undefined) {
        if (typeof rule.if !== 'string') {
          add({ id: 'rule-if-type', severity: 'error', title: `${who}: правило ${i + 1}: if должен быть строкой`, when: CONFIG_WHEN, how: rejected(`${where}:rule if should be a string`), why: `YAML прочитал значение как ${typeof rule.if}.`, fix: "Возьмите выражение в кавычки: if: '$VAR == \"x\"'", ...at([i, 'if']), job });
        } else {
          const parsed = parseExpr(rule.if);
          if (parsed.error) {
            add({ id: 'rule-if-syntax', severity: 'error', title: `${who}: ошибка в условии ${q(rule.if)}`, when: CONFIG_WHEN, how: rejected(`${where}:rule if invalid expression syntax`), why: `${parsed.error[0].toUpperCase()}${parsed.error.slice(1)}.`, fix: 'Пример: if: \'$CI_COMMIT_BRANCH == "main" && $CI_PIPELINE_SOURCE == "push"\'', ...at([i, 'if']), job });
          } else {
            for (const v of parsed.vars) checkVarName(v, { ...at([i, 'if']), job }, 'rules');
            checkComparisons(parsed.ast, { ...at([i, 'if']), job }, who);
          }
        }
      }
      if (rule.exists !== undefined) {
        const paths = arr(isObj(rule.exists) ? rule.exists.paths : rule.exists).map(String);
        if (paths.length && !(isObj(rule.exists) && rule.exists.project) && paths.every((p) => !/\$/.test(p) && !repo.glob(p) && !repo.hasFile(p))) {
          add({ id: 'rule-exists-none', severity: 'warning', title: `${who}: правило ${i + 1}: exists — таких файлов нет`, when: CONFIG_WHEN, how: 'Правило никогда не сработает, пока такие файлы не появятся в репозитории.', why: `Под ${paths.map(q).join(', ')} не подходит ни один файл репозитория.`, fix: 'Проверьте путь/шаблон (от корня репозитория, регистр букв).', ...at([i, 'exists']), job });
        }
      }
      if (rule.changes !== undefined) {
        const ch = isObj(rule.changes) ? rule.changes : { paths: rule.changes };
        if (isObj(rule.changes)) for (const k of Object.keys(rule.changes)) if (!['paths', 'compare_to'].includes(k)) add({ id: 'rule-changes-key', severity: 'error', title: `${who}: правило ${i + 1}: changes — неизвестный ключ ${q(k)}`, when: CONFIG_WHEN, how: rejected(`${where}:rule:changes config contains unknown keys: ${k}`), why: 'Допустимы paths и compare_to.', fix: 'changes:\n  paths:\n    - src/**/*', ...at([i, 'changes', k]), job });
        const paths = arr(ch.paths).map(String);
        if (paths.length && paths.every((p) => !/\$/.test(p) && !repo.glob(p) && !repo.hasFile(p) && !repo.hasDir(p))) {
          add({ id: 'rule-changes-none', severity: 'info', title: `${who}: правило ${i + 1}: changes — сейчас таких файлов нет`, when: 'При push и в merge request', how: 'Правило не сработает при обычных изменениях (только если такие файлы добавят).', why: `Под ${paths.map(q).join(', ')} сейчас не подходит ни один файл.`, fix: 'Проверьте шаблон: «src/**/*» — все файлы в src, «*.md» — только в корне.', ...at([i, 'changes']), job });
        }
      }
      const isCatchAll = rule.if === undefined && rule.changes === undefined && rule.exists === undefined;
      if (catchAll >= 0) {
        add({ id: 'rule-unreachable', severity: 'warning', title: `${who}: правило ${i + 1} никогда не проверяется`, when: CONFIG_WHEN, how: 'Ошибки не будет, но это правило ни на что не влияет.', why: `Правило ${catchAll + 1} без условий срабатывает всегда, а GitLab берёт первое подходящее правило.`, fix: 'Переставьте правило без условий в конец списка.', ...at([i]), job });
        catchAll = Infinity; // сообщаем один раз
      } else if (isCatchAll && i < rules.length - 1) catchAll = i;
    });
    const real = rules.filter(isObj);
    if (!workflow && real.length && real.every((r) => r.when === 'never')) {
      add({ id: 'rules-all-never', severity: 'warning', title: `${who}: все правила — when: never`, when: CONFIG_WHEN, how: 'Задание не попадёт ни в один пайплайн.', why: 'Если ни одно правило не включает задание, оно исключается; здесь все правила только исключают.', fix: 'Добавьте в конец правило «- when: on_success» (или нужное условие).', ...at([]), job });
    }
    if (workflow && real.length && real.every((r) => r.when === 'never')) {
      add({ id: 'workflow-all-never', severity: 'error', title: 'workflow:rules: все правила — when: never', when: CONFIG_WHEN, how: 'Пайплайн не будет создаваться никогда.', why: 'Если ни одно правило workflow не сработало с when: always, пайплайн не создаётся.', fix: 'Добавьте в конец «- when: always» или правило с нужным условием.', ...at([]) });
    }
  }

  // Сравнения с CI_PIPELINE_SOURCE и с ветками
  function checkComparisons(ast, at, who) {
    const walk = (n) => {
      if (!n) return;
      if (n.t === 'and' || n.t === 'or') {
        walk(n.left);
        walk(n.right);
        return;
      }
      if (n.t !== 'cmp' || (n.op !== '==' && n.op !== '!=')) return;
      const [v, s] = n.left.t === 'var' && n.right.t === 'str' ? [n.left.v, n.right.v] : n.right.t === 'var' && n.left.t === 'str' ? [n.right.v, n.left.v] : [];
      if (!v) return;
      if (v === 'CI_PIPELINE_SOURCE' && !PIPELINE_SOURCES.includes(s)) {
        const near = suggest(s, PIPELINE_SOURCES);
        add({ id: 'pipeline-source-value', severity: 'warning', title: `${who}: CI_PIPELINE_SOURCE никогда не равен ${q(s)}`, when: CONFIG_WHEN, how: `Условие ${n.op === '==' ? 'никогда не выполнится' : 'выполнится всегда'}.`, why: `Возможные значения: ${PIPELINE_SOURCES.slice(0, 10).join(', ')}…${near ? ` Возможно, имелось в виду ${q(near)}.` : ''}`, fix: near ? `Замените на "${near}".` : 'Проверьте значение.', ...at });
      }
      if (['CI_COMMIT_BRANCH', 'CI_COMMIT_REF_NAME', 'CI_MERGE_REQUEST_TARGET_BRANCH_NAME', 'CI_MERGE_REQUEST_SOURCE_BRANCH_NAME', 'CI_DEFAULT_BRANCH'].includes(v) && branches.size && !branches.has(s)) {
        const swapped = (s === 'master' && defBranch === 'main') || (s === 'main' && defBranch === 'master');
        add({
          id: swapped ? 'branch-main-master' : 'branch-missing',
          severity: swapped ? 'warning' : 'info',
          title: `${who}: ветки ${q(s)} нет в репозитории`,
          when: CONFIG_WHEN,
          how: swapped ? `Условие с ${q(s)} никогда не сработает — основная ветка здесь ${q(defBranch)}.` : `Условие сработает, только когда появится ветка ${q(s)}.`,
          why: `Сравнивается $${v} с ${q(s)}, а в репозитории ${swapped ? `основная ветка — ${q(defBranch)}` : 'такой ветки нет (ни локально, ни на удалённом сервере)'}.`,
          fix: swapped ? `Используйте $CI_DEFAULT_BRANCH вместо "${s}" — так условие не зависит от названия ветки.` : 'Если это опечатка — исправьте; для основной ветки лучше $CI_DEFAULT_BRANCH.',
          ...at,
        });
      }
    };
    walk(ast);
  }

  function checkOnly(name, key, spec) {
    const at = (kp) => locate(name, [key, ...kp]);
    const refs = isObj(spec) ? spec.refs : spec;
    if (isObj(spec)) {
      for (const k of Object.keys(spec)) if (!ONLY_KEYS.includes(k)) add({ id: 'only-unknown-key', severity: 'error', title: `${q(name)}: ${key} — неизвестный ключ ${q(k)}`, when: CONFIG_WHEN, how: rejected(`jobs:${name}:${key} config contains unknown keys: ${k}`), why: `Допустимы: ${ONLY_KEYS.join(', ')}.${didYouMean(k, ONLY_KEYS)}`, fix: 'Исправьте ключ (а лучше перейдите на rules).', ...at([k]), job: name });
      for (const [i, expr] of arr(spec.variables).entries()) {
        const p = parseExpr(expr);
        if (p.error) add({ id: 'only-variables-syntax', severity: 'error', title: `${q(name)}: ошибка в ${key}:variables ${q(expr)}`, when: CONFIG_WHEN, how: rejected(`jobs:${name}:${key}:variables invalid expression syntax`), why: `${p.error}.`, fix: 'Пример: - $CI_COMMIT_MESSAGE =~ /deploy/', ...at(['variables', i]), job: name });
      }
    }
    for (const [i, r] of arr(refs).entries()) {
      const s = String(r);
      if (ONLY_REFS.includes(s) || s.startsWith('/') || /@/.test(s)) continue;
      const near = suggest(s, ONLY_REFS);
      if (near && !branches.has(s)) {
        add({ id: 'only-keyword-typo', severity: 'warning', title: `${q(name)}: ${key}: ${s} — это имя ветки, а не ${q(near)}`, when: CONFIG_WHEN, how: `GitLab поймёт ${q(s)} как название ветки или тега и ${key === 'only' ? 'будет запускать задание только для неё' : 'исключит только её'}.`, why: `Ключевое слово пишется ${q(near)}.`, fix: `Замените на ${near}.`, ...at(isObj(spec) ? ['refs', i] : [i]), job: name });
      }
    }
    if (!onlyJobs.some((o) => o.name === name)) onlyJobs.push({ name, ...at([]) });
  }

  function checkVariables(vars, at, where, job) {
    if (vars === undefined || vars === null) return;
    if (!isObj(vars)) {
      if (job) add({ id: 'variables-not-hash', severity: 'error', title: `${q(job)}: variables должен быть набором «ИМЯ: значение»`, when: CONFIG_WHEN, how: rejected(`${where} config should be a hash of key value pairs`), why: Array.isArray(vars) ? 'Сейчас это список (через «- »).' : 'Сейчас это не карта.', fix: 'variables:\n  NAME: value', ...at([]), job });
      return;
    }
    for (const [k, v] of Object.entries(vars)) {
      const loc = { ...at([k]), job };
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) add({ id: 'variable-name', severity: 'warning', title: `Имя переменной ${q(k)} недоступно в shell`, when: job ? `При выполнении задания ${q(job)}` : 'При выполнении заданий', how: `В скрипте $${k} не раскроется (${/-/.test(k) ? 'дефис' : 'символ'} в имени не допускается shell).`, why: 'Имена переменных окружения — латинские буквы, цифры и «_», не с цифры.', fix: `Переименуйте, например ${k.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1')}.`, ...loc });
      if (typeof v === 'boolean') {
        add({ id: 'variable-boolean', severity: 'error', title: `${k}: ${v} — логическое значение без кавычек`, when: CONFIG_WHEN, how: rejected(`${where} config should be a hash of key value pairs, value can be a hash`), why: 'Значения переменных — строки; YAML прочитал true/false/yes/no как логическое значение.', fix: `${k}: "${v}"`, ...loc });
      } else if (Array.isArray(v)) {
        add({ id: 'variable-array', severity: 'error', title: `${k}: значение — список`, when: CONFIG_WHEN, how: rejected(`${where} config should be a hash of key value pairs, value can be a hash`), why: 'Переменная не может быть списком.', fix: `${k}: "a b c"`, ...loc });
      } else if (isObj(v)) {
        for (const kk of Object.keys(v)) if (!['value', 'description', 'options', 'expand'].includes(kk)) add({ id: 'variable-key', severity: 'error', title: `${k}: неизвестный ключ ${q(kk)}`, when: CONFIG_WHEN, how: rejected(`${where}:${k} config uses invalid data keys: ${kk}`), why: 'Допустимы value, description, options, expand.', fix: 'Уберите ключ.', ...loc });
        if (v.options !== undefined && v.value !== undefined && !arr(v.options).map(String).includes(String(v.value))) add({ id: 'variable-options', severity: 'error', title: `${k}: значение ${q(v.value)} не входит в options`, when: CONFIG_WHEN, how: rejected(`${where}:${k} config value must be present in options`), why: `options: ${arr(v.options).join(', ')}.`, fix: 'Добавьте значение в options или исправьте value.', ...loc });
        if (v.options !== undefined && job) add({ id: 'variable-options-job', severity: 'warning', title: `${k}: options в переменной задания`, when: CONFIG_WHEN, how: 'options работают только у глобальных переменных (форма ручного запуска).', why: 'Здесь они ничего не дадут.', fix: 'Перенесите переменную в глобальный variables.', ...loc });
      }
      const value = isObj(v) ? v.value : v;
      if (typeof value === 'string' || typeof value === 'number') {
        const s = String(value);
        const strong = SECRET_VALUE.find(([re]) => re.test(s));
        if (strong) add({ id: 'secret-value', severity: 'error', title: `${k}: в файле открытым текстом ${strong[1]}`, when: 'Уже сейчас — файл в истории Git', how: 'Любой, у кого есть доступ к репозиторию (или к его копии), получит этот ключ; в логах заданий значение тоже не скрывается.', why: 'Переменные из .gitlab-ci.yml не маскируются и не защищены.', fix: 'Отзовите ключ, создайте новый и сохраните его в Settings → CI/CD → Variables (Masked, Protected); в файле оставьте только имя.', ...loc });
        else if (SECRET_NAME.test(k) && s.length >= 6 && !looksLikeVarRef(s) && !/^(true|false|none|null|changeme|example|placeholder|\*+|x+)$/i.test(s) && !/\$/.test(s)) add({ id: 'secret-name', severity: 'warning', title: `${k}: похоже на секрет в открытом виде`, when: 'Уже сейчас — файл в истории Git', how: 'Значение видно всем, у кого есть доступ к репозиторию, и не маскируется в логах.', why: `Имя ${q(k)} похоже на пароль/токен, а значение задано прямо в файле.`, fix: 'Перенесите значение в Settings → CI/CD → Variables (Masked) и удалите из файла.', ...loc });
      }
    }
  }

  function checkImageName(img, job, keyPath, what = 'образ') {
    const s = String(img).trim();
    const ji = (o) => (job ? jobIssue(job, keyPath, o) : globIssue(keyPath, o));
    const who = job ? q(job) : 'default';
    const runWhen = job ? `При запуске задания ${q(job)}` : 'При запуске каждого задания с этим образом';
    if (!s) return ji({ id: 'image-empty', severity: 'error', title: `${who}: пустой ${what}`, how: rejected(`${job ? `jobs:${job}` : 'default'}:image config should be a hash or a string`), why: 'Имя образа не задано.', fix: 'image: node:20' });
    if (/\s/.test(s)) return ji({ id: 'image-space', severity: 'error', title: `${who}: пробел в имени образа ${q(s)}`, when: runWhen, how: 'Задание упадёт: «invalid reference format».', why: 'В имени образа не может быть пробелов.', fix: 'Проверьте имя.' });
    const repoPart = s.replace(/@sha256:.*$/, '').replace(/:[^/:]+$/, '');
    if (/\$/.test(s)) {
      const vars = [...s.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]).filter((v) => !PREDEFINED.has(v) && !yamlVars.has(v));
      if (vars.length) ji({ id: 'image-variable', severity: 'info', title: `${who}: ${what} ${s} зависит от $${vars[0]}`, when: runWhen, how: `Если $${vars[0]} не задана в настройках проекта, задание упадёт: «invalid reference format» или «pull access denied».`, why: 'Переменная не объявлена в файле.', fix: `Объявите значение по умолчанию в variables: ${vars[0]}: …` });
      return;
    }
    if (/[A-Z]/.test(repoPart)) ji({ id: 'image-uppercase', severity: 'error', title: `${who}: заглавные буквы в имени образа ${q(s)}`, when: runWhen, how: 'Задание упадёт: «invalid reference format: repository name must be lowercase».', why: 'Имена образов Docker — только строчные.', fix: `image: ${repoPart.toLowerCase()}${s.slice(repoPart.length)}` });
    else if (!/[:@]/.test(s.replace(/^[^/]+:\d+\//, '')) || /:latest$/.test(s)) ji({ id: 'image-latest', severity: 'info', title: `${who}: ${what} ${s} без версии`, when: runWhen, how: 'Сегодня работает, а после выхода новой версии образа задание может внезапно сломаться.', why: 'Без тега берётся :latest — он меняется со временем.', fix: `Укажите версию: ${repoPart}:<версия>` });
  }

  function checkImage(image, job, keyPath) {
    const who = job ? q(job) : 'default';
    const issue = (kp, o) => (job ? jobIssue(job, kp, o) : globIssue(kp, o));
    const jn = job ? `jobs:${job}` : 'default';
    if (image === undefined) return;
    if (image === null || image === '') return checkImageName('', job, keyPath);
    if (isObj(image)) {
      for (const k of Object.keys(image)) if (!['name', 'entrypoint', 'docker', 'pull_policy', 'kubernetes'].includes(k)) issue([...keyPath, k], { id: 'image-key', severity: 'error', title: `${who}: image — неизвестный ключ ${q(k)}`, how: rejected(`${jn}:image config contains unknown keys: ${k}`), why: 'Допустимы name, entrypoint, docker, pull_policy, kubernetes.', fix: 'Уберите ключ.' });
      if (!image.name) return issue(keyPath, { id: 'image-no-name', severity: 'error', title: `${who}: у image нет name`, how: rejected(`${jn}:image config must have a name`), why: 'Нужно указать образ.', fix: 'image:\n  name: node:20' });
      return checkImageName(image.name, job, [...keyPath, 'name']);
    }
    if (typeof image !== 'string') return issue(keyPath, { id: 'image-type', severity: 'error', title: `${who}: image должен быть строкой`, how: rejected(`${jn}:image config should be a hash or a string`), why: `Сейчас: ${JSON.stringify(image)}.`, fix: 'image: node:20' });
    return checkImageName(image, job, keyPath);
  }

  function checkArtifacts(name, a) {
    const ji = (kp, o) => jobIssue(name, ['artifacts', ...kp], o);
    if (!isObj(a)) return ji([], { id: 'artifacts-type', severity: 'error', title: `${q(name)}: artifacts должен быть картой`, how: rejected(`jobs:${name}:artifacts config should be a hash`), why: 'artifacts содержит paths, expire_in и т.д.', fix: 'artifacts:\n  paths:\n    - dist/' });
    for (const k of Object.keys(a)) if (!ARTIFACT_KEYS.includes(k)) ji([k], { id: 'artifacts-unknown-key', severity: 'error', title: `${q(name)}: artifacts — неизвестный ключ ${q(k)}`, how: rejected(`jobs:${name}:artifacts config contains unknown keys: ${k}`), why: `Допустимы: ${ARTIFACT_KEYS.join(', ')}.${didYouMean(k, ARTIFACT_KEYS)}`, fix: 'Исправьте ключ.' });
    if (a.paths !== undefined && !Array.isArray(a.paths)) ji(['paths'], { id: 'artifacts-paths-type', severity: 'error', title: `${q(name)}: artifacts:paths должен быть списком`, how: rejected(`jobs:${name}:artifacts:paths config should be an array of strings`), why: 'Даже один путь пишется списком.', fix: `paths:\n  - ${a.paths}` });
    for (const [i, p] of arr(a.paths).entries()) {
      const s = String(p);
      if (s.startsWith('/') || s.startsWith('../') || s === '..' || s.startsWith('~')) ji(['paths', i], { id: 'artifacts-outside', severity: 'warning', title: `${q(name)}: путь артефакта ${q(s)} вне папки проекта`, when: `В конце задания ${q(name)}`, how: `Файлы не сохранятся: «WARNING: ${s}: not supported: outside build directory» и «ERROR: No files to upload».`, why: 'Артефакты можно брать только внутри $CI_PROJECT_DIR.', fix: 'Копируйте файлы в папку проекта и указывайте относительный путь.' });
    }
    if (!arr(a.paths).length && !a.untracked && !isObj(a.reports) && a.paths === undefined) ji([], { id: 'artifacts-empty', severity: 'warning', title: `${q(name)}: в artifacts не указано, что сохранять`, when: `В конце задания ${q(name)}`, how: 'Раннер ничего не загрузит: «WARNING: No files to upload».', why: 'Нет ни paths, ни reports, ни untracked.', fix: 'artifacts:\n  paths:\n    - dist/' });
    if (a.expire_in !== undefined && String(a.expire_in) !== 'never' && durationSeconds(a.expire_in) == null) ji(['expire_in'], { id: 'artifacts-expire', severity: 'error', title: `${q(name)}: не разобрать expire_in: ${a.expire_in}`, how: rejected(`jobs:${name}:artifacts expire in should be a duration`), why: 'Пишется как «1 week», «30 days» или «never».', fix: 'expire_in: 1 week' });
    if (a.when !== undefined && !SIMPLE_WHEN.includes(a.when)) ji(['when'], { id: 'artifacts-when', severity: 'error', title: `${q(name)}: artifacts:when ${a.when}`, how: rejected(`jobs:${name}:artifacts when should be on_success, on_failure or always`), why: `Неизвестное значение.${didYouMean(a.when, SIMPLE_WHEN)}`, fix: 'when: always' });
    if (isObj(a.reports)) {
      for (const [k, v] of Object.entries(a.reports)) {
        if (REMOVED_REPORTS[k]) ji(['reports', k], { id: 'report-removed', severity: 'error', title: `${q(name)}: отчёт ${q(k)} больше не поддерживается`, how: rejected(`jobs:${name}:artifacts:reports config contains unknown keys: ${k}`), why: 'Тип отчёта удалён из GitLab.', fix: `Используйте ${REMOVED_REPORTS[k]}.` });
        else if (!REPORTS.includes(k)) ji(['reports', k], { id: 'report-unknown', severity: 'error', title: `${q(name)}: неизвестный тип отчёта ${q(k)}`, how: rejected(`jobs:${name}:artifacts:reports config contains unknown keys: ${k}`), why: `Неизвестный тип.${didYouMean(k, REPORTS)}`, fix: 'Проверьте название отчёта.' });
        if (k === 'coverage_report' && (!isObj(v) || !v.coverage_format || !v.path)) ji(['reports', k], { id: 'coverage-report-format', severity: 'error', title: `${q(name)}: coverage_report без coverage_format/path`, how: rejected(`jobs:${name}:artifacts:reports:coverage_report config must have coverage_format and path`), why: 'Нужны оба ключа.', fix: 'coverage_report:\n  coverage_format: cobertura\n  path: coverage/cobertura-coverage.xml' });
        if (k === 'coverage_report' && isObj(v) && v.coverage_format && !['cobertura', 'jacoco'].includes(v.coverage_format)) ji(['reports', k, 'coverage_format'], { id: 'coverage-format-value', severity: 'error', title: `${q(name)}: coverage_format ${v.coverage_format}`, how: rejected('coverage_format must be cobertura or jacoco'), why: 'Поддерживаются cobertura и jacoco.', fix: 'coverage_format: cobertura' });
      }
    }
  }

  function checkCache(name, cache, kp) {
    const list = arr(cache);
    if (list.length > 4) jobIssue(name, kp, { id: 'cache-limit', severity: 'error', title: `${q(name)}: больше 4 кэшей`, how: rejected(`jobs:${name}:cache config no more than 4 caches can be created`), why: 'Ограничение GitLab.', fix: 'Объедините кэши.' });
    list.forEach((c, idx) => {
      const ckp = Array.isArray(cache) ? [...kp, idx] : kp;
      const ji = (sub, o) => jobIssue(name, [...ckp, ...sub], o);
      if (!isObj(c)) return ji([], { id: 'cache-type', severity: 'error', title: `${q(name)}: cache должен быть картой`, how: rejected(`jobs:${name}:cache config should be a hash`), why: 'cache содержит key, paths, policy.', fix: 'cache:\n  key: $CI_COMMIT_REF_SLUG\n  paths:\n    - node_modules/' });
      for (const k of Object.keys(c)) if (!CACHE_KEYS.includes(k)) ji([k], { id: 'cache-unknown-key', severity: 'error', title: `${q(name)}: cache — неизвестный ключ ${q(k)}`, how: rejected(`jobs:${name}:cache config contains unknown keys: ${k}`), why: `Допустимы: ${CACHE_KEYS.join(', ')}.${didYouMean(k, CACHE_KEYS)}`, fix: 'Исправьте ключ.' });
      if (typeof c.key === 'string' || typeof c.key === 'number') {
        const k = String(c.key);
        if (/\/|%2F/i.test(k) || k === '.' || k === '..' || /%2E/i.test(k)) ji(['key'], { id: 'cache-key-slash', severity: 'error', title: `${q(name)}: в cache:key есть «/» или это «.»`, how: rejected(`jobs:${name}:cache:key config cannot contain the "/" character or be "."`), why: 'Ключ кэша становится частью имени файла.', fix: 'Используйте $CI_COMMIT_REF_SLUG вместо $CI_COMMIT_REF_NAME (в нём нет «/»).' });
        if (/\$CI_COMMIT_REF_NAME|\$CI_COMMIT_BRANCH/.test(k)) ji(['key'], { id: 'cache-key-refname', severity: 'warning', title: `${q(name)}: cache:key с именем ветки`, when: `В ветках со «/» в имени (feature/x)`, how: 'Кэш не сохранится: имя ветки со слэшем недопустимо в ключе.', why: '$CI_COMMIT_REF_NAME может содержать «/».', fix: 'Используйте $CI_COMMIT_REF_SLUG.' });
      } else if (isObj(c.key)) {
        const files = arr(c.key.files);
        if (files.length > 2) ji(['key', 'files'], { id: 'cache-key-files', severity: 'error', title: `${q(name)}: cache:key:files больше двух`, how: rejected(`jobs:${name}:cache:key:files config has too many entries (maximum 2)`), why: 'Ключ можно строить максимум по двум файлам.', fix: 'Оставьте 1–2 файла (обычно lock-файл).' });
        for (const f of files) if (!/\$|\*/.test(String(f)) && !repo.hasFile(String(f))) ji(['key', 'files'], { id: 'cache-key-file-missing', severity: 'warning', title: `${q(name)}: cache:key:files — нет файла ${f}`, when: `При выполнении задания ${q(name)}`, how: 'Кэш будет общим с ключом «default» для всех веток и не будет сбрасываться при изменении зависимостей.', why: `Файла ${q(f)} нет в репозитории.`, fix: 'Укажите существующий lock-файл.' });
        for (const k of Object.keys(c.key)) if (!['files', 'prefix', 'files_commits'].includes(k)) ji(['key', k], { id: 'cache-key-key', severity: 'error', title: `${q(name)}: cache:key — неизвестный ключ ${q(k)}`, how: rejected(`jobs:${name}:cache:key config contains unknown keys: ${k}`), why: 'Допустимы files и prefix.', fix: 'Уберите ключ.' });
      }
      if (c.policy !== undefined && !['pull', 'push', 'pull-push'].includes(c.policy) && !/\$/.test(String(c.policy))) ji(['policy'], { id: 'cache-policy', severity: 'error', title: `${q(name)}: cache:policy ${c.policy}`, how: rejected(`jobs:${name}:cache policy should be pull-push, push, or pull`), why: `Неизвестное значение.${didYouMean(c.policy, ['pull', 'push', 'pull-push'])}`, fix: 'policy: pull' });
      if (c.when !== undefined && !SIMPLE_WHEN.includes(c.when)) ji(['when'], { id: 'cache-when', severity: 'error', title: `${q(name)}: cache:when ${c.when}`, how: rejected(`jobs:${name}:cache when should be on_success, on_failure or always`), why: 'Неизвестное значение.', fix: 'when: on_success' });
      if (c.paths !== undefined && !Array.isArray(c.paths)) ji(['paths'], { id: 'cache-paths-type', severity: 'error', title: `${q(name)}: cache:paths должен быть списком`, how: rejected(`jobs:${name}:cache:paths config should be an array of strings`), why: 'Даже один путь пишется списком.', fix: `paths:\n  - ${c.paths}` });
      if (!arr(c.paths).length && !c.untracked) ji([], { id: 'cache-empty', severity: 'warning', title: `${q(name)}: в cache не указано, что кэшировать`, when: `В конце задания ${q(name)}`, how: 'Кэш не будет создан: раннер пропустит шаг сохранения кэша.', why: 'Нет ни paths, ни untracked.', fix: 'paths:\n  - node_modules/' });
      for (const [i, p] of arr(c.paths).entries()) if (/^(\/|\.\.\/|~)/.test(String(p))) ji(['paths', i], { id: 'cache-outside', severity: 'warning', title: `${q(name)}: путь кэша ${q(p)} вне папки проекта`, when: `В конце задания ${q(name)}`, how: `«WARNING: ${p}: not supported: outside build directory» — путь не попадёт в кэш.`, why: 'Кэшировать можно только внутри папки проекта.', fix: 'Перенесите кэш внутрь проекта (например, npm_config_cache: .npm).' });
    });
  }

  function checkEnvironment(name, env) {
    const ji = (kp, o) => jobIssue(name, ['environment', ...kp], o);
    const e = typeof env === 'string' ? { name: env } : env;
    if (!isObj(e)) return ji([], { id: 'env-type', severity: 'error', title: `${q(name)}: environment должен быть строкой или картой`, how: rejected(`jobs:${name}:environment config should be a hash or a string`), why: 'Задайте имя окружения.', fix: 'environment: production' });
    for (const k of Object.keys(e)) if (!ENV_KEYS.includes(k)) ji([k], { id: 'env-unknown-key', severity: 'error', title: `${q(name)}: environment — неизвестный ключ ${q(k)}`, how: rejected(`jobs:${name}:environment config contains unknown keys: ${k}`), why: `Допустимы: ${ENV_KEYS.join(', ')}.${didYouMean(k, ENV_KEYS)}`, fix: 'Исправьте ключ.' });
    if (!e.name) ji([], { id: 'env-no-name', severity: 'error', title: `${q(name)}: у окружения нет name`, how: rejected(`jobs:${name}:environment name can't be blank`), why: 'Окружение определяется именем.', fix: 'environment:\n  name: production' });
    else if (!/^[A-Za-z0-9 _\-/${}.]+$/.test(String(e.name))) ji(['name'], { id: 'env-name', severity: 'error', title: `${q(name)}: недопустимое имя окружения ${q(e.name)}`, how: rejected(`jobs:${name}:environment name can contain only letters, digits, '-', '_', '/', '$', '{', '}', '.', and spaces`), why: 'В имени есть запрещённые символы.', fix: 'Например: review/$CI_COMMIT_REF_SLUG' });
    if (e.url !== undefined && !/^https?:\/\//i.test(String(e.url)) && !/^\$/.test(String(e.url))) ji(['url'], { id: 'env-url', severity: 'error', title: `${q(name)}: environment:url ${e.url} — не адрес`, how: rejected(`jobs:${name}:environment url must be a valid url`), why: 'URL должен начинаться с http:// или https://.', fix: `url: https://${e.url}` });
    if (e.action !== undefined && !ENV_ACTIONS.includes(e.action)) ji(['action'], { id: 'env-action', severity: 'error', title: `${q(name)}: environment:action ${e.action}`, how: rejected(`jobs:${name}:environment action should be start, stop, prepare, verify, or access`), why: `Неизвестное значение.${didYouMean(e.action, ENV_ACTIONS)}`, fix: 'action: stop' });
    if (e.deployment_tier !== undefined && !TIERS.includes(e.deployment_tier)) ji(['deployment_tier'], { id: 'env-tier', severity: 'error', title: `${q(name)}: deployment_tier ${e.deployment_tier}`, how: rejected(`jobs:${name}:environment deployment_tier must be one of: ${TIERS.join(', ')}`), why: `Неизвестное значение.${didYouMean(e.deployment_tier, TIERS)}`, fix: 'deployment_tier: production' });
    if (e.auto_stop_in !== undefined && String(e.auto_stop_in) !== 'never' && durationSeconds(e.auto_stop_in) == null) ji(['auto_stop_in'], { id: 'env-auto-stop', severity: 'error', title: `${q(name)}: не разобрать auto_stop_in: ${e.auto_stop_in}`, how: rejected(`jobs:${name}:environment auto stop in should be a duration`), why: 'Пишется как «1 week», «2 days».', fix: 'auto_stop_in: 1 week' });
    if (e.on_stop !== undefined) {
      const stopJob = String(e.on_stop);
      const sc = resolved.get(stopJob);
      if (!sc || stopJob.startsWith('.')) ji(['on_stop'], { id: 'env-on-stop-missing', severity: 'error', title: `${q(name)}: on_stop ссылается на несуществующее ${q(stopJob)}`, how: rejected(`${name} job: on_stop job ${stopJob} is not defined`), why: `Задания ${q(stopJob)} нет.${didYouMean(stopJob, visible)}`, fix: 'Добавьте задание остановки окружения или поправьте имя.' });
      else {
        const se = typeof sc.environment === 'string' ? { name: sc.environment } : sc.environment;
        if (!isObj(se) || se.action !== 'stop') jobIssue(stopJob, ['environment'], { id: 'env-stop-action', severity: 'error', title: `${q(stopJob)}: нет environment:action: stop`, how: rejected(`${name} job: on_stop job ${stopJob} is not defined as a stop job (environment:action: stop is missing)`), why: `${q(stopJob)} указан в on_stop у ${q(name)}, значит должен останавливать окружение.`, fix: `${stopJob}:\n  environment:\n    name: ${e.name}\n    action: stop` });
        else if (se.name !== e.name) jobIssue(stopJob, ['environment', 'name'], { id: 'env-stop-name', severity: 'error', title: `${q(stopJob)}: другое имя окружения`, how: rejected(`${name} job: on_stop job ${stopJob} has different environment name`), why: `Окружение ${q(name)} — ${q(e.name)}, а у ${q(stopJob)} — ${q(se.name)}.`, fix: `Используйте одно имя: ${e.name}.` });
        if (sc.when !== 'manual' && !arr(sc.rules).some((r) => r?.when === 'manual')) jobIssue(stopJob, [], { id: 'env-stop-auto', severity: 'warning', title: `${q(stopJob)} запустится автоматически`, when: 'В каждом пайплайне с этим заданием', how: 'Окружение будет остановлено сразу после развёртывания.', why: 'Задание остановки без when: manual выполняется как обычное.', fix: 'when: manual' });
      }
    }
  }

  /* =================== Прогон сценариев =================== */

  function simulate() {
    const def = defBranch || 'main';
    const feature = 'feature/example';
    const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 63);
    const base = { CI: 'true', GITLAB_CI: 'true', CI_DEFAULT_BRANCH: def, CI_COMMIT_SHA: '0123456789abcdef0123456789abcdef01234567', CI_COMMIT_SHORT_SHA: '01234567', CI_PIPELINE_ID: '1001', CI_PIPELINE_IID: '1', CI_PROJECT_NAME: 'project', CI_PROJECT_PATH: 'group/project', CI_SERVER_HOST: 'gitlab.example.com' };
    const branch = (b, source, extra = {}) => ({ ...base, CI_PIPELINE_SOURCE: source, CI_COMMIT_BRANCH: b, CI_COMMIT_REF_NAME: b, CI_COMMIT_REF_SLUG: slug(b), CI_COMMIT_REF_PROTECTED: b === def ? 'true' : 'false', CI_COMMIT_BEFORE_SHA: source === 'push' ? 'fedcba9876543210fedcba9876543210fedcba98' : '0000000000000000000000000000000000000000', ...extra });
    const list = [
      { id: 'push-default', title: `Push в ${def}`, ref: { type: 'branch', name: def }, vars: branch(def, 'push') },
      { id: 'push-branch', title: `Push в ${feature}`, ref: { type: 'branch', name: feature }, vars: branch(feature, 'push') },
      { id: 'mr', title: `Merge request ${feature} → ${def}`, ref: { type: 'mr', name: feature }, vars: { ...base, CI_PIPELINE_SOURCE: 'merge_request_event', CI_COMMIT_REF_NAME: feature, CI_COMMIT_REF_SLUG: slug(feature), CI_MERGE_REQUEST_ID: '501', CI_MERGE_REQUEST_IID: '12', CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: feature, CI_MERGE_REQUEST_TARGET_BRANCH_NAME: def, CI_MERGE_REQUEST_EVENT_TYPE: 'detached', CI_MERGE_REQUEST_REF_PATH: 'refs/merge-requests/12/head', CI_MERGE_REQUEST_TARGET_BRANCH_PROTECTED: 'true', CI_COMMIT_REF_PROTECTED: 'false', CI_COMMIT_BEFORE_SHA: '0000000000000000000000000000000000000000' } },
      { id: 'tag', title: 'Тег v1.0.0', ref: { type: 'tag', name: 'v1.0.0' }, vars: { ...base, CI_PIPELINE_SOURCE: 'push', CI_COMMIT_TAG: 'v1.0.0', CI_COMMIT_REF_NAME: 'v1.0.0', CI_COMMIT_REF_SLUG: 'v1-0-0', CI_COMMIT_REF_PROTECTED: 'false', CI_COMMIT_BEFORE_SHA: '0000000000000000000000000000000000000000' } },
      { id: 'schedule', title: `Расписание (${def})`, ref: { type: 'branch', name: def }, vars: branch(def, 'schedule') },
      { id: 'web', title: `Запуск вручную (${def})`, ref: { type: 'branch', name: def }, vars: branch(def, 'web') },
    ];
    // Скрытый сценарий: push в ветку, по которой открыт MR — для поиска двойных пайплайнов
    const dup = { id: 'push-branch-mr', title: `Push в ${feature} с открытым MR`, ref: { type: 'branch', name: feature }, vars: branch(feature, 'push', { CI_OPEN_MERGE_REQUESTS: 'group/project!12' }) };
    const globalVars = Object.fromEntries(Object.entries(isObj(globals.variables) ? globals.variables : {}).map(([k, v]) => [k, isObj(v) ? String(v.value ?? '') : v == null ? '' : String(v)]));

    const out = [];
    const runs = new Map();
    for (const sc of [...list, dup]) {
      const run = runScenario(sc, globalVars);
      runs.set(sc.id, run);
      if (sc !== dup) out.push(run);
    }

    // Двойные пайплайны: и ветка, и MR
    const mr = runs.get('mr');
    const pb = runs.get('push-branch-mr');
    if (mr.created && mr.jobs.length && pb.created && pb.jobs.length) {
      add({
        id: 'duplicate-pipelines',
        severity: 'warning',
        title: 'Двойные пайплайны: для ветки и для merge request',
        when: `При каждом push в ветку с открытым merge request`,
        how: `Запустятся два пайплайна на один коммит: «branch» (${pb.jobs.length} задан.) и «merge request» (${mr.jobs.length} задан.) — раннеры заняты вдвое, статус MR может зависеть от любого из них.`,
        why: 'Правила допускают и push-пайплайны для любой ветки, и пайплайны merge request, а условие «если MR уже открыт — не создавать пайплайн ветки» не задано.',
        fix: 'workflow:\n  rules:\n    - if: $CI_PIPELINE_SOURCE == "merge_request_event"\n    - if: $CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS\n      when: never\n    - if: $CI_COMMIT_BRANCH',
        file: workflow ? globalLoc(['workflow']).file : main,
        line: workflow ? globalLoc(['workflow']).line : 1,
      });
    }
    // Открыт MR — и ничего не запускается: пайплайн ветки запрещён, а в пайплайне MR нет заданий
    const pbNoMr = runs.get('push-branch');
    if (pbNoMr.created && !pb.created && !mr.created) {
      add({
        id: 'mr-nothing-runs',
        severity: 'warning',
        title: 'При открытом merge request не запускается ничего',
        when: 'При push в ветку, по которой открыт merge request',
        how: `Пайплайн ветки не создаётся (${pb.reason}), а пайплайн merge request пустой (${mr.reason}) — изменения уходят без проверок.`,
        why: 'Правила запрещают пайплайн ветки при открытом MR, но задания не настроены для пайплайнов MR.',
        fix: 'Добавьте заданиям правило - if: $CI_PIPELINE_SOURCE == "merge_request_event" или разрешите MR в workflow:rules.',
        file: main,
        line: workflow ? globalLoc(['workflow']).line : 1,
      });
    }
    // Ни одного пайплайна для основных событий
    const mainRuns = out.filter((r) => ['push-default', 'push-branch', 'mr', 'tag'].includes(r.id));
    if (visible.length && mainRuns.every((r) => !r.created) && !mainRuns.some((r) => r.uncertain)) {
      add({ id: 'pipeline-never', severity: 'warning', title: 'Пайплайн не создаётся ни при push, ни для MR, ни для тега', when: 'При push, merge request и теге', how: 'Ничего не будет запускаться — GitLab молча не создаст пайплайн.', why: mainRuns.map((r) => `${r.title}: ${r.reason}`).join('; '), fix: 'Проверьте workflow:rules и rules заданий.', file: main, line: workflow ? globalLoc(['workflow']).line : 1 });
    }
    // Задания, которые не попадают ни в один сценарий
    for (const name of visible) {
      if (out.some((r) => r.jobs.some((j) => j.name === name) || r.excluded.some((x) => x.name === name && x.uncertain))) continue;
      if (out.every((r) => !r.created && r.workflowBlocked)) continue;
      const cfg = resolved.get(name);
      if (cfg.when === 'never' || (Array.isArray(cfg.rules) && cfg.rules.filter(isObj).every((r) => r.when === 'never'))) continue;
      if (Array.isArray(cfg.rules) && cfg.rules.some((r) => isObj(r) && typeof r.if === 'string' && parseExpr(r.if).error)) continue;
      jobIssue(name, cfg.rules ? ['rules'] : cfg.only ? ['only'] : [], { id: 'job-never-runs', severity: 'info', title: `${q(name)} не попадает ни в один типичный пайплайн`, when: out.map((r) => r.title).join(', '), how: 'Задание не запустится при push, MR, теге, по расписанию и при ручном запуске.', why: out.map((r) => r.excluded.find((x) => x.name === name)?.why).filter(Boolean)[0] ?? 'Условия rules/only не выполняются.', fix: 'Если задание запускается через API/триггер или по особой переменной — всё в порядке; иначе проверьте условия.' });
    }
    return out;
  }

  function runScenario(sc, globalVars) {
    const vars = { ...globalVars, ...sc.vars };
    const res = { id: sc.id, title: sc.title, ref: sc.ref, vars: pickVars(sc.vars), created: false, reason: '', uncertain: null, jobs: [], excluded: [], problems: [] };
    // workflow
    if (workflow && Array.isArray(workflow.rules)) {
      const m = evalRules(workflow.rules, vars, sc);
      if (!m.rule || m.rule.when === 'never') {
        res.workflowBlocked = true;
        res.reason = !m.rule ? 'ни одно правило workflow:rules не подошло' : `workflow:rules, правило ${m.index + 1}: when: never`;
        res.uncertain = m.uncertain.length ? m.uncertain.join(', ') : null;
        return res;
      }
      if (isObj(m.rule.variables)) Object.assign(vars, Object.fromEntries(Object.entries(m.rule.variables).map(([k, v]) => [k, String(v)])));
      res.workflowRule = m.index + 1;
    }
    for (const name of visible) {
      const cfg = resolved.get(name);
      const jobVars = { ...vars, ...Object.fromEntries(Object.entries(isObj(cfg.variables) ? cfg.variables : {}).map(([k, v]) => [k, isObj(v) ? String(v.value ?? '') : String(v ?? '')])) };
      let included;
      let when = cfg.when ?? 'on_success';
      let why;
      let allowFailure = cfg.allow_failure === true || isObj(cfg.allow_failure);
      let uncertain = [];
      if (Array.isArray(cfg.rules)) {
        const m = evalRules(cfg.rules, jobVars, sc);
        uncertain = m.uncertain;
        if (!m.rule) {
          included = false;
          why = 'ни одно правило rules не подошло';
        } else if (m.rule.when === 'never') {
          included = false;
          why = `правило ${m.index + 1}: when: never`;
        } else {
          included = true;
          when = m.rule.when ?? cfg.when ?? 'on_success';
          // when: manual в rules — по умолчанию allow_failure: false (в отличие от when: manual у задания)
          allowFailure = m.rule.allow_failure ?? (m.rule.when === 'manual' ? false : allowFailure);
          why = `правило ${m.index + 1}`;
        }
      } else if (cfg.when === 'never') {
        included = false;
        why = 'when: never';
      } else {
        const only = cfg.only ?? ['branches', 'tags'];
        // Задания без rules/only/except попадают в пайплайн MR, только если его разрешает workflow:rules
        const o = !cfg.only && !cfg.except && sc.ref.type === 'mr' && res.workflowRule ? { match: true, uncertain: [] } : evalOnlySpec(only, sc, jobVars);
        const e = cfg.except !== undefined ? evalOnlySpec(cfg.except, sc, jobVars) : { match: false, uncertain: [] };
        uncertain = [...o.uncertain, ...e.uncertain];
        included = o.match && !e.match;
        if (cfg.when === 'manual') allowFailure = cfg.allow_failure ?? true;
        why = !o.match ? (cfg.only ? 'не подходит под only' : 'без rules задание по умолчанию только для веток и тегов (only: branches, tags)') : e.match ? 'исключено except' : cfg.only ? 'подходит под only' : 'без условий';
        res.defaultOnly = res.defaultOnly ?? [];
        if (!cfg.only && !cfg.except && !o.match) res.defaultOnly.push(name);
      }
      if (included) res.jobs.push({ name, stage: stageOf(name), when, allowFailure, why, uncertain: uncertain.length ? uncertain.join(', ') : null });
      else res.excluded.push({ name, why, uncertain: uncertain.length ? uncertain.join(', ') : null });
    }
    const realJobs = res.jobs.filter((j) => !['.pre', '.post'].includes(j.stage));
    res.created = realJobs.length > 0;
    if (!res.jobs.length) res.reason = 'ни одно задание не подошло под условия';
    else if (!realJobs.length) res.reason = 'есть только задания этапов .pre/.post';
    else res.reason = res.workflowRule ? `workflow:rules, правило ${res.workflowRule}` : 'есть подходящие задания';
    res.uncertain = [...new Set(res.jobs.concat(res.excluded).map((j) => j.uncertain).filter(Boolean))].join(', ') || null;
    if (!res.created) {
      if (sc.id === 'web' || sc.id === 'push-default') {
        add({
          id: 'scenario-empty',
          severity: sc.id === 'web' ? 'warning' : 'info',
          title: `${sc.title}: пайплайн не создастся`,
          when: sc.title,
          how: sc.id === 'web' ? 'При нажатии «Run pipeline» GitLab ответит: «Pipeline will not run for the selected trigger. The rules configuration prevented any jobs from being added to the pipeline.»' : 'Пайплайн просто не появится.',
          why: res.reason + (res.jobs.length ? '' : '.'),
          fix: sc.id === 'web' ? 'Если ручной запуск нужен — добавьте правило: - if: $CI_PIPELINE_SOURCE == "web"' : 'Проверьте rules заданий.',
          file: main,
          line: workflow ? globalLoc(['workflow']).line : 1,
          scenario: sc.id,
        });
      }
      if (sc.id === 'mr' && res.defaultOnly?.length) res.reason += ' (задания без rules попадают в пайплайн MR, только если его разрешает workflow:rules)';
      return res;
    }
    // Проблемы сценария: зависимости от заданий, которых нет в этом пайплайне
    const inPipe = new Set(res.jobs.map((j) => j.name));
    for (const j of res.jobs) {
      const cfg = resolved.get(j.name);
      for (const n of arr(cfg.needs)) {
        const target = typeof n === 'string' ? n : n?.job;
        if (!target || (isObj(n) && (n.optional || n.pipeline || n.project)) || !visible.includes(target) || inPipe.has(target)) continue;
        const ex = res.excluded.find((x) => x.name === target);
        const msg = `'${j.name}' job needs '${target}' job, but '${target}' does not exist in the pipeline. This might be because of the only, except, or rules keywords. To need a job that sometimes does not exist in the pipeline, use needs:optional.`;
        res.problems.push(msg);
        jobIssue(j.name, ['needs'], { id: 'scenario-needs-missing', severity: j.uncertain || ex?.uncertain ? 'warning' : 'error', title: `${sc.title}: ${q(j.name)} ждёт ${q(target)}, которого не будет`, when: sc.title, how: `GitLab не создаст пайплайн: «${msg}»`, why: `${q(j.name)} попадает в пайплайн (${j.why}), а ${q(target)} — нет (${ex?.why ?? 'исключено'}).`, fix: `Сделайте условия ${q(j.name)} и ${q(target)} одинаковыми или добавьте optional: true:\nneeds:\n  - job: ${target}\n    optional: true`, scenario: sc.id });
      }
      if (cfg.needs === undefined) {
        for (const dep of arr(cfg.dependencies)) {
          if (!visible.includes(dep) || inPipe.has(dep)) continue;
          res.problems.push(`${j.name} job: undefined dependency: ${dep}`);
          jobIssue(j.name, ['dependencies'], { id: 'scenario-dependency-missing', severity: 'error', title: `${sc.title}: ${q(j.name)} берёт артефакты у ${q(dep)}, которого не будет`, when: sc.title, how: `GitLab не создаст пайплайн: «${j.name} job: undefined dependency: ${dep}»`, why: `${q(dep)} исключено в этом пайплайне (${res.excluded.find((x) => x.name === dep)?.why ?? '—'}).`, fix: 'Согласуйте условия заданий или уберите зависимость.', scenario: sc.id });
        }
      }
      const env = isObj(cfg.environment) ? cfg.environment : null;
      if (env?.on_stop && visible.includes(String(env.on_stop)) && !inPipe.has(String(env.on_stop))) {
        res.problems.push(`${j.name} job: on_stop job ${env.on_stop} is not defined`);
        jobIssue(j.name, ['environment', 'on_stop'], { id: 'scenario-on-stop-missing', severity: 'error', title: `${sc.title}: задание остановки ${q(env.on_stop)} не попадает в пайплайн`, when: sc.title, how: `GitLab не создаст пайплайн: «${j.name} job: on_stop job ${env.on_stop} is not defined»`, why: `${q(j.name)} есть в пайплайне, а ${q(env.on_stop)} — нет.`, fix: `Дайте ${q(env.on_stop)} те же rules, что у ${q(j.name)} (с when: manual).`, scenario: sc.id });
      }
      if (isObj(cfg.release) && /\$CI_COMMIT_TAG\b/.test(String(cfg.release.tag_name)) && sc.ref.type !== 'tag') {
        jobIssue(j.name, ['release', 'tag_name'], { id: 'scenario-release-no-tag', severity: 'warning', title: `${sc.title}: ${q(j.name)} создаёт релиз без тега`, when: sc.title, how: 'Задание упадёт: $CI_COMMIT_TAG пустой — «tag_name is missing» / «release tag name can\'t be blank».', why: 'Задание с release: tag_name: $CI_COMMIT_TAG попадает в пайплайн без тега.', fix: 'rules:\n  - if: $CI_COMMIT_TAG', scenario: sc.id });
      }
      // Ручное задание, которое останавливает пайплайн
      if (j.when === 'manual' && j.allowFailure === false) {
        const later = res.jobs.filter((o) => stageIndex(o.name) > stageIndex(j.name) && resolved.get(o.name).needs === undefined).map((o) => o.name);
        jobIssue(j.name, cfg.rules ? ['rules'] : ['when'], { id: 'manual-blocking', severity: 'info', title: `${q(j.name)} — ручное и блокирующее`, when: sc.title, how: `Пайплайн остановится в статусе «blocked» и будет ждать нажатия ▶${later.length ? `; задания ${later.slice(0, 4).map(q).join(', ')} не стартуют до этого` : ''}.`, why: cfg.rules ? 'У when: manual внутри rules allow_failure по умолчанию false (в отличие от when: manual у самого задания).' : 'allow_failure: false у ручного задания.', fix: 'Если ждать не нужно — добавьте allow_failure: true рядом с when: manual.', scenario: sc.id });
      }
    }
    return res;
  }

  function pickVars(v) {
    const keys = ['CI_PIPELINE_SOURCE', 'CI_COMMIT_BRANCH', 'CI_COMMIT_TAG', 'CI_MERGE_REQUEST_SOURCE_BRANCH_NAME', 'CI_MERGE_REQUEST_TARGET_BRANCH_NAME', 'CI_OPEN_MERGE_REQUESTS'];
    return Object.fromEntries(keys.filter((k) => v[k] != null).map((k) => [k, v[k]]));
  }

  /** Первое подходящее правило: { rule, index, uncertain: [причины] } */
  function evalRules(rules, vars, sc) {
    const uncertain = [];
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (!isObj(r)) continue;
      let ok = true;
      if (r.if !== undefined) {
        const p = parseExpr(r.if);
        if (p.error) {
          ok = false;
        } else {
          for (const v of p.vars) {
            if (vars[v] !== undefined && !CONTENT_VARS.test(v)) continue;
            if (PREDEFINED.has(v) && !CONTENT_VARS.test(v)) continue;
            uncertain.push(`$${v}`);
          }
          ok = evalExpr(p.ast, vars);
        }
      }
      if (ok && r.exists !== undefined) {
        const paths = arr(isObj(r.exists) ? r.exists.paths : r.exists).map(String);
        if (paths.some((p) => /\$/.test(p))) uncertain.push('exists');
        else ok = paths.some((p) => repo.glob(p) || repo.hasFile(p));
      }
      if (ok && r.changes !== undefined) {
        // Для тегов, расписаний, ручного запуска и новых веток changes всегда «истина»
        if (sc.vars.CI_PIPELINE_SOURCE === 'push' && !sc.vars.CI_COMMIT_TAG) uncertain.push('изменённые файлы (changes)');
        else if (sc.vars.CI_PIPELINE_SOURCE === 'merge_request_event') uncertain.push('изменённые файлы (changes)');
      }
      if (ok) return { rule: r, index: i, uncertain: [...new Set(uncertain)] };
    }
    return { rule: null, index: -1, uncertain: [...new Set(uncertain)] };
  }

  /** only/except: { match, uncertain } */
  function evalOnlySpec(spec, sc, vars) {
    const uncertain = [];
    const refsMatch = (refs) =>
      arr(refs).some((r) => {
        const s = String(r).replace(/@.*$/, '');
        const src = sc.vars.CI_PIPELINE_SOURCE;
        const refName = sc.ref.name;
        switch (s) {
          case 'branches':
            return sc.ref.type === 'branch';
          case 'tags':
            return sc.ref.type === 'tag';
          case 'merge_requests':
            return src === 'merge_request_event';
          case 'schedules':
            return src === 'schedule';
          case 'web':
            return src === 'web';
          case 'pushes':
            return src === 'push';
          case 'api':
          case 'triggers':
          case 'pipelines':
          case 'external':
          case 'chat':
          case 'external_pull_requests':
            return src === s.replace(/s$/, '') || src === s;
          default:
            if (s.startsWith('/')) {
              const m = /^\/(.*)\/([a-z]*)$/.exec(s);
              try {
                return m ? new RegExp(m[1], m[2]).test(refName) && sc.ref.type !== 'mr' : false;
              } catch {
                return false;
              }
            }
            return sc.ref.type !== 'mr' && s === refName;
        }
      });
    if (!isObj(spec)) return { match: refsMatch(spec), uncertain };
    let match = true;
    if (spec.refs !== undefined) match = match && refsMatch(spec.refs);
    if (spec.variables !== undefined) {
      match =
        match &&
        arr(spec.variables).some((e) => {
          const p = parseExpr(e);
          if (p.error) return false;
          for (const v of p.vars) if (!(v in vars) && (!PREDEFINED.has(v) || CONTENT_VARS.test(v))) uncertain.push(`$${v}`);
          return evalExpr(p.ast, vars);
        });
    }
    if (spec.changes !== undefined && match && (sc.vars.CI_PIPELINE_SOURCE === 'push' && !sc.vars.CI_COMMIT_TAG)) uncertain.push('изменённые файлы (changes)');
    return { match, uncertain };
  }
}

module.exports = { checkGitlab, PREDEFINED };
