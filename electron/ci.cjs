// Просмотр настроек CI/CD, которые лежат в самом репозитории.
// Только чтение: файлы конфигурации разбираются локально, без сети и токенов.
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('./vendor/yaml.cjs');
const { git, hasHead, safeRelative } = require('./git.cjs');
const { GitError } = require('./errors.cjs');
const ciEdit = require('./ciEdit.cjs');
const { checkCi } = require('./ciCheck.cjs');

const MAX_FILE_SIZE = 512 * 1024;
const MAX_INCLUDE_DEPTH = 6;
const FS = '\x1f';

/* =================== Обнаружение =================== */

const SYSTEMS = [
  { id: 'gitlab', title: 'GitLab CI', files: ['.gitlab-ci.yml', '.gitlab-ci.yaml'] },
  { id: 'github', title: 'GitHub Actions', dir: '.github/workflows', ext: /\.ya?ml$/i },
  { id: 'jenkins', title: 'Jenkins', files: ['Jenkinsfile'] },
  { id: 'bitbucket', title: 'Bitbucket Pipelines', files: ['bitbucket-pipelines.yml'] },
  { id: 'circleci', title: 'CircleCI', files: ['.circleci/config.yml', '.circleci/config.yaml'] },
  { id: 'azure', title: 'Azure Pipelines', files: ['azure-pipelines.yml', 'azure-pipelines.yaml'] },
  { id: 'travis', title: 'Travis CI', files: ['.travis.yml'] },
  { id: 'drone', title: 'Drone CI', files: ['.drone.yml'] },
  { id: 'woodpecker', title: 'Woodpecker CI', files: ['.woodpecker.yml'], dir: '.woodpecker', ext: /\.ya?ml$/i },
];

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Быстрая проверка (только fs): какие системы CI найдены в корне репозитория */
function detectCi(root) {
  const systems = [];
  for (const sys of SYSTEMS) {
    const files = [];
    for (const rel of sys.files ?? []) if (isFile(path.join(root, rel))) files.push(rel);
    if (sys.dir) {
      try {
        for (const name of fs.readdirSync(path.join(root, sys.dir)).sort()) {
          if (sys.ext.test(name) && isFile(path.join(root, sys.dir, name))) files.push(`${sys.dir}/${name}`);
        }
      } catch {
        /* папки нет */
      }
    }
    if (files.length) systems.push({ id: sys.id, title: sys.title, files });
  }
  return systems;
}

/* =================== YAML =================== */

// GitLab: !reference [.job, script] — ссылка на кусок другого задания
const REFERENCE_TAG = {
  tag: '!reference',
  collection: 'seq',
  resolve: (seq) => ({ __reference: seq.toJSON() }),
};

function parseYaml(text, file) {
  const lineCounter = new YAML.LineCounter();
  const doc = YAML.parseDocument(text, {
    lineCounter,
    merge: true,
    customTags: [REFERENCE_TAG],
    prettyErrors: true,
    uniqueKeys: false,
  });
  const errors = [...doc.errors, ...doc.warnings.filter((w) => w.code !== 'TAG_RESOLVE_FAILED')].map((e) => ({
    file,
    message: String(e.message).split('\n')[0].replace(/:\s*$/, ''),
    line: e.linePos?.[0]?.line ?? null,
    severity: doc.errors.includes(e) ? 'error' : 'warning',
  }));
  let data = null;
  try {
    data = doc.toJS({ maxAliasCount: 1000 }) ?? {};
  } catch (error) {
    errors.push({ file, message: error.message, line: null, severity: 'error' });
  }
  // Строки, на которых начинаются ключи верхнего уровня — для перехода «показать в файле»
  const lines = {};
  if (YAML.isMap(doc.contents)) {
    for (const pair of doc.contents.items) {
      const key = pair.key?.value ?? pair.key?.source;
      if (key != null && pair.key?.range) lines[String(key)] = lineCounter.linePos(pair.key.range[0]).line;
    }
  }
  // Для вложенных карт (jobs в GitHub, pipelines в Bitbucket) — тоже запоминаем строки
  const nestedLines = (keyPath) => {
    const node = doc.getIn(keyPath, true);
    const out = {};
    if (YAML.isMap(node)) {
      for (const pair of node.items) {
        const key = pair.key?.value ?? pair.key?.source;
        if (key != null && pair.key?.range) out[String(key)] = lineCounter.linePos(pair.key.range[0]).line;
      }
    }
    return out;
  };
  return { data: isPlainObject(data) ? data : {}, errors, lines, nestedLines };
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const toYaml = (v) => {
  try {
    return YAML.stringify(v, { lineWidth: 0 }).trimEnd();
  } catch {
    return JSON.stringify(v, null, 2);
  }
};

// Скрипт может быть строкой, массивом или массивом с вложенными массивами (после !reference)
function scriptLines(value) {
  const out = [];
  const walk = (v) => {
    if (v == null) return;
    if (Array.isArray(v)) v.forEach(walk);
    else if (isPlainObject(v) && v.__reference) out.push(`!reference [${v.__reference.join(', ')}]`);
    else out.push(String(v));
  };
  walk(value);
  return out;
}

function deepMerge(base, over) {
  if (!isPlainObject(base) || !isPlainObject(over)) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}

/* =================== Чтение файлов =================== */

// Черновики из редактора: путь → текст. Пока задан, разбор идёт по ним, а не по файлам на диске
let overrides = null;
const normRel = (rel) => rel.replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');

function readText(root, rel) {
  if (overrides?.has(normRel(rel))) return overrides.get(normRel(rel)).replace(/^\uFEFF/, '');
  const full = safeRelative(root, rel);
  const stat = fs.statSync(full);
  if (stat.size > MAX_FILE_SIZE) {
    throw new GitError(`Файл ${rel} слишком большой (${Math.round(stat.size / 1024)} КБ)`, { code: 'TOO_LARGE' });
  }
  return fs.readFileSync(full, 'utf8').replace(/^﻿/, '');
}

// Простейший glob для include: local: 'ci/*.yml' или 'ci/**/*.yml'
function expandLocalGlob(root, pattern) {
  const rel = pattern.replace(/^\/+/, '');
  if (!/[*?]/.test(rel)) return [rel];
  const source = rel
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '(?:.*/)?')
    .replace(/\u0001/g, '.*');
  const re = new RegExp(`^${source}$`);
  const found = [];
  const walk = (dir, prefix, depth) => {
    if (depth > 6) return;
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const relPath = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), relPath, depth + 1);
      else if (re.test(relPath)) found.push(relPath);
    }
  };
  walk('', '', 0);
  return found.sort();
}

/* =================== GitLab CI =================== */

const GITLAB_GLOBAL = new Set([
  'default',
  'include',
  'stages',
  'types',
  'variables',
  'workflow',
  'image',
  'services',
  'cache',
  'before_script',
  'after_script',
  'spec',
]);
const DEFAULT_STAGES = ['.pre', 'build', 'test', 'deploy', '.post'];

function normalizeInclude(entry) {
  if (typeof entry === 'string') {
    return /^https?:\/\//i.test(entry) ? { type: 'remote', value: entry } : { type: 'local', value: entry };
  }
  if (!isPlainObject(entry)) return { type: 'unknown', value: JSON.stringify(entry) };
  if (entry.local) return { type: 'local', value: entry.local, rules: entry.rules ?? null };
  if (entry.project) {
    return { type: 'project', value: `${entry.project}${entry.ref ? `@${entry.ref}` : ''}: ${asArray(entry.file).join(', ')}` };
  }
  if (entry.remote) return { type: 'remote', value: entry.remote };
  if (entry.template) return { type: 'template', value: entry.template };
  if (entry.component) return { type: 'component', value: entry.component };
  return { type: 'unknown', value: toYaml(entry) };
}

function loadGitlab(root, mainFile) {
  const files = []; // { path, text }
  const errors = [];
  const includes = [];
  const jobs = new Map(); // name -> { config, source, line }
  const jobDefs = []; // все определения заданий по файлам — для проверки повторов
  const globalDefs = []; // { key, source } — глобальные ключи по файлам
  let globals = {};
  const seen = new Set();

  const visit = (rel, depth, via) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    let text;
    try {
      text = readText(root, rel);
    } catch (error) {
      errors.push({ file: via, message: `Не удалось прочитать ${rel}: ${error.message}`, line: null, severity: 'error' });
      return;
    }
    files.push({ path: rel, text });
    const parsed = parseYaml(text, rel);
    errors.push(...parsed.errors);
    const data = parsed.data;

    // Сначала подключаемые файлы: основной файл переопределяет их
    for (const raw of asArray(data.include)) {
      const inc = { ...normalizeInclude(raw), from: rel, resolved: false, files: [] };
      includes.push(inc);
      if (inc.type !== 'local') continue;
      if (depth >= MAX_INCLUDE_DEPTH) {
        inc.error = 'Слишком глубокая вложенность include';
        continue;
      }
      const matched = expandLocalGlob(root, inc.value);
      inc.files = matched.filter((f) => isFile(path.join(root, f)));
      if (inc.files.length === 0) {
        inc.error = 'Файл не найден в репозитории';
        continue;
      }
      inc.resolved = true;
      for (const f of inc.files) visit(f, depth + 1, rel);
    }

    for (const [key, value] of Object.entries(data)) {
      if (GITLAB_GLOBAL.has(key)) {
        globalDefs.push({ key, source: rel, line: parsed.lines[key] ?? null });
        globals[key] = key === 'variables' || key === 'default' ? deepMerge(globals[key] ?? {}, value ?? {}) : value;
        continue;
      }
      jobDefs.push({ name: key, source: rel, line: parsed.lines[key] ?? null, value });
      if (!isPlainObject(value)) continue;
      const prev = jobs.get(key);
      jobs.set(key, {
        config: prev ? deepMerge(prev.config, value) : value,
        source: rel,
        line: parsed.lines[key] ?? null,
      });
    }
  };

  visit(mainFile, 0, mainFile);

  // extends: наследование заданий (глубокое слияние, массивы заменяются)
  const resolvedCache = new Map();
  const warnings = [];
  const resolveJob = (name, stack = []) => {
    if (resolvedCache.has(name)) return resolvedCache.get(name);
    const entry = jobs.get(name);
    if (!entry) return null;
    if (stack.includes(name)) {
      warnings.push(`Циклическое наследование: ${[...stack, name].join(' → ')}`);
      return { config: entry.config, chain: [] };
    }
    let merged = {};
    const chain = [];
    for (const parent of asArray(entry.config.extends)) {
      const p = resolveJob(parent, [...stack, name]);
      if (!p) {
        warnings.push(`«${name}»: extends ссылается на неизвестное задание «${parent}»`);
        continue;
      }
      chain.push(parent, ...p.chain.filter((c) => !chain.includes(c) && c !== name && c !== parent));
      merged = deepMerge(merged, p.config);
    }
    const own = { ...entry.config };
    delete own.extends;
    const result = { config: deepMerge(merged, own), chain };
    resolvedCache.set(name, result);
    return result;
  };

  // !reference [.job, key, subkey] — подстановка куска другого задания
  const resolveReferences = (value, depth = 0) => {
    if (depth > 10) return value;
    if (Array.isArray(value)) {
      const out = [];
      for (const item of value) {
        const r = resolveReferences(item, depth + 1);
        if (isPlainObject(item) && item.__reference && Array.isArray(r)) out.push(...r);
        else out.push(r);
      }
      return out;
    }
    if (isPlainObject(value)) {
      if (value.__reference) {
        const [jobName, ...keys] = value.__reference;
        let target = jobName in globals ? globals[jobName] : resolveJob(jobName)?.config;
        for (const k of keys) target = target?.[k];
        if (target === undefined) {
          const msg = `!reference [${value.__reference.join(', ')}] ссылается на то, чего нет`;
          if (!warnings.includes(msg)) warnings.push(msg);
          return value;
        }
        return resolveReferences(target, depth + 1);
      }
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveReferences(v, depth + 1)]));
    }
    return value;
  };

  globals = resolveReferences(globals);
  const defaults = isPlainObject(globals.default) ? globals.default : {};
  const declaredStages = asArray(globals.stages ?? globals.types).map(String);
  const stageNames = declaredStages.length ? ['.pre', ...declaredStages.filter((s) => s !== '.pre' && s !== '.post'), '.post'] : DEFAULT_STAGES;

  const visibleJobs = [];
  const templates = [];
  for (const [name, entry] of jobs) {
    const { config, chain } = resolveJob(name) ?? { config: entry.config, chain: [] };
    const cfg = resolveReferences(config);
    if (name.startsWith('.')) {
      templates.push({ id: name, name, line: entry.line, source: entry.source, raw: toYaml(entry.config), usedBy: [] });
      continue;
    }
    visibleJobs.push(gitlabJob(name, cfg, entry, chain, globals, defaults));
  }
  for (const t of templates) t.usedBy = visibleJobs.filter((j) => j.extends.includes(t.name)).map((j) => j.name);

  const stages = stageNames.map((name) => ({ name, jobs: [] }));
  for (const job of visibleJobs) {
    let stage = stages.find((s) => s.name === job.stage);
    if (!stage) {
      warnings.push(`«${job.name}»: этап «${job.stage}» не объявлен в stages — GitLab не запустит пайплайн`);
      stage = { name: job.stage, jobs: [], undeclared: true };
      stages.splice(stages.length - 1, 0, stage);
    }
    stage.jobs.push(job);
  }
  for (const job of visibleJobs) {
    for (const need of job.needs ?? []) {
      if (!need.optional && !visibleJobs.some((j) => j.name === need.job) && !need.external) {
        warnings.push(`«${job.name}»: needs ссылается на задание «${need.job}», которого нет`);
      }
    }
  }
  const usedStages = stages.filter((s) => s.jobs.length || (!s.name.startsWith('.') && declaredStages.includes(s.name)));

  const workflow = isPlainObject(globals.workflow) ? globals.workflow : null;
  const info = [];
  if (workflow?.name) info.push({ label: 'Название пайплайна', value: String(workflow.name) });
  const image = imageName(defaults.image ?? globals.image);
  if (image) info.push({ label: 'Образ по умолчанию', value: image });
  if (defaults.tags) info.push({ label: 'Теги раннеров', value: asArray(defaults.tags).join(', ') });

  return {
    files,
    errors,
    warnings,
    includes,
    info,
    triggers: workflow?.rules ? asArray(workflow.rules).map(ruleText) : [],
    triggersTitle: 'Когда создаётся пайплайн (workflow:rules)',
    variables: variablesList(globals.variables),
    pipelines: [{ id: 'main', title: 'Пайплайн', stages: usedStages }],
    templates,
    // Для проверки конфигурации (ciCheck.cjs); в интерфейс не уходит
    _raw: { jobs, jobDefs, globalDefs, resolveJob, resolveReferences, globals, declaredStages, stageNames, includes },
  };
}

function imageName(image) {
  if (!image) return null;
  if (typeof image === 'string') return image;
  if (isPlainObject(image)) return image.name ?? null;
  return null;
}

function variablesList(vars) {
  if (!isPlainObject(vars)) return [];
  return Object.entries(vars).map(([name, v]) =>
    isPlainObject(v)
      ? { name, value: v.value == null ? '' : String(v.value), description: v.description ?? null, options: v.options ?? null }
      : { name, value: v == null ? '' : String(v) },
  );
}

// Короткая запись значения в одну строку: { branches: { include: [main] } } → «branches include: main»
function compact(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(compact).join(', ');
  if (isPlainObject(value)) {
    return Object.entries(value)
      .map(([k, v]) => (isPlainObject(v) ? `${k} ${compact(v)}` : `${k}: ${compact(v)}`))
      .join('; ');
  }
  return String(value);
}

function ruleText(rule) {
  if (!isPlainObject(rule)) return { text: String(rule) };
  const parts = [];
  if (rule.if) parts.push(`если ${rule.if}`);
  if (rule.changes) {
    const ch = isPlainObject(rule.changes) ? asArray(rule.changes.paths) : asArray(rule.changes);
    parts.push(`изменены ${ch.join(', ')}`);
  }
  if (rule.exists) parts.push(`существует ${asArray(isPlainObject(rule.exists) ? rule.exists.paths : rule.exists).join(', ')}`);
  if (parts.length === 0) parts.push('во всех остальных случаях');
  const when = rule.when ?? 'on_success';
  return {
    text: parts.join(' и '),
    when,
    allowFailure: rule.allow_failure ?? null,
    variables: isPlainObject(rule.variables) ? Object.keys(rule.variables) : [],
  };
}

function onlyExceptText(v) {
  if (v == null) return null;
  if (typeof v === 'string' || Array.isArray(v)) return asArray(v).join(', ');
  if (isPlainObject(v)) {
    return Object.entries(v)
      .map(([k, val]) => `${k}: ${asArray(val).join(', ')}`)
      .join('; ');
  }
  return String(v);
}

function gitlabJob(name, cfg, entry, chain, globals, defaults) {
  const inherit = cfg.inherit ?? {};
  const inheritDefault = inherit.default !== false;
  const inheritKey = (key) => inheritDefault === true || (Array.isArray(inherit.default) && inherit.default.includes(key));
  const fromDefault = (key) => {
    if (cfg[key] !== undefined) return { value: cfg[key], inherited: false };
    if (inheritKey(key) && defaults[key] !== undefined) return { value: defaults[key], inherited: 'default' };
    if (inheritKey(key) && globals[key] !== undefined) return { value: globals[key], inherited: 'глобально' };
    return { value: undefined, inherited: false };
  };
  const image = fromDefault('image');
  const before = fromDefault('before_script');
  const after = fromDefault('after_script');

  const needs = cfg.needs === undefined ? null : asArray(cfg.needs).map((n) =>
    typeof n === 'string'
      ? { job: n }
      : { job: n.job ?? n.pipeline ?? '?', optional: Boolean(n.optional), artifacts: n.artifacts, external: Boolean(n.pipeline || n.project) },
  );

  const env = cfg.environment;
  const artifacts = isPlainObject(cfg.artifacts) ? cfg.artifacts : null;
  const isTrigger = cfg.trigger !== undefined;
  const when = cfg.when ?? 'on_success';

  return {
    id: name,
    name,
    stage: String(cfg.stage ?? 'test'),
    source: entry.source,
    line: entry.line,
    kind: isTrigger ? 'trigger' : 'job',
    when,
    startIn: cfg.start_in ?? null,
    manual: when === 'manual' || asArray(cfg.rules).some((r) => r?.when === 'manual'),
    allowFailure: cfg.allow_failure === true || isPlainObject(cfg.allow_failure),
    image: imageName(image.value),
    imageInherited: image.inherited,
    services: asArray(cfg.services ?? (inheritKey('services') ? defaults.services ?? globals.services : undefined)).map((s) => imageName(s) ?? String(s)),
    tags: asArray(cfg.tags ?? (inheritKey('tags') ? defaults.tags : undefined)).map(String),
    beforeScript: before.value !== undefined ? { lines: scriptLines(before.value), inherited: before.inherited } : null,
    script: cfg.script !== undefined ? { lines: scriptLines(cfg.script), inherited: false } : null,
    afterScript: after.value !== undefined ? { lines: scriptLines(after.value), inherited: after.inherited } : null,
    rules: cfg.rules ? asArray(cfg.rules).map(ruleText) : [],
    only: onlyExceptText(cfg.only),
    except: onlyExceptText(cfg.except),
    needs,
    dependencies: cfg.dependencies ? asArray(cfg.dependencies).map(String) : null,
    environment: env ? (typeof env === 'string' ? { name: env } : { name: env.name, url: env.url ?? null, action: env.action ?? null }) : null,
    artifacts: artifacts
      ? {
          paths: asArray(artifacts.paths).map(String),
          expire: artifacts.expire_in ?? null,
          reports: isPlainObject(artifacts.reports) ? Object.keys(artifacts.reports) : [],
          when: artifacts.when ?? null,
        }
      : null,
    cache: cfg.cache ? toYaml(cfg.cache) : null,
    variables: variablesList(cfg.variables),
    parallel: cfg.parallel == null ? null : isPlainObject(cfg.parallel) ? `matrix × ${asArray(cfg.parallel.matrix).length}` : `× ${cfg.parallel}`,
    trigger: isTrigger ? (typeof cfg.trigger === 'string' ? cfg.trigger : cfg.trigger.project ?? toYaml(cfg.trigger.include ?? cfg.trigger)) : null,
    extends: chain,
    timeout: cfg.timeout ?? null,
    retry: cfg.retry == null ? null : isPlainObject(cfg.retry) ? `${cfg.retry.max ?? '?'} раз` : `${cfg.retry} раз`,
    interruptible: cfg.interruptible ?? null,
    resourceGroup: cfg.resource_group ?? null,
    coverage: cfg.coverage ?? null,
    raw: toYaml(cfg),
    // Для визуальной правки: какие ключи заданы в самом задании (а не унаследованы) и простые ли правила
    own: Object.keys(entry.config ?? {}),
    rulesEditable: asArray(cfg.rules).every((r) => isPlainObject(r) && Object.keys(r).every((k) => ['if', 'when', 'allow_failure'].includes(k))),
    rulesRaw: asArray(cfg.rules)
      .filter(isPlainObject)
      .map((r) => ({ if: r.if ?? '', when: r.when ?? 'on_success', allow_failure: r.allow_failure === true })),
    scriptRaw: cfg.script === undefined ? null : scriptLines(cfg.script),
    needsRaw: cfg.needs === undefined ? null : asArray(cfg.needs).map((n) => (typeof n === 'string' ? n : n?.job ?? '')).filter(Boolean),
  };
}

/* =================== GitHub Actions =================== */

function githubTriggers(on) {
  if (on == null) return [];
  if (typeof on === 'string') return [{ text: on }];
  if (Array.isArray(on)) return on.map((e) => ({ text: String(e) }));
  return Object.entries(on).map(([event, cfg]) => {
    const details = [];
    if (isPlainObject(cfg)) {
      for (const key of ['branches', 'branches-ignore', 'tags', 'tags-ignore', 'paths', 'paths-ignore', 'types']) {
        if (cfg[key]) details.push(`${key}: ${asArray(cfg[key]).join(', ')}`);
      }
      if (cfg.inputs && isPlainObject(cfg.inputs)) details.push(`параметры: ${Object.keys(cfg.inputs).join(', ')}`);
      if (cfg.workflows) details.push(`после: ${asArray(cfg.workflows).join(', ')}`);
    }
    if (Array.isArray(cfg)) for (const c of cfg) if (c?.cron) details.push(`cron: ${c.cron}`);
    return { text: event + (details.length ? ` — ${details.join('; ')}` : '') };
  });
}

// Колонки по зависимостям needs: задания без зависимостей — в первой колонке
function levelize(jobs, depsOf) {
  const level = new Map();
  const names = new Set(jobs.map((j) => j.name));
  const visit = (job, stack = []) => {
    if (level.has(job.name)) return level.get(job.name);
    if (stack.includes(job.name)) return 0;
    let lv = 0;
    for (const dep of depsOf(job)) {
      if (!names.has(dep)) continue;
      const depJob = jobs.find((j) => j.name === dep);
      lv = Math.max(lv, visit(depJob, [...stack, job.name]) + 1);
    }
    level.set(job.name, lv);
    return lv;
  };
  jobs.forEach((j) => visit(j));
  const max = Math.max(0, ...level.values());
  return Array.from({ length: max + 1 }, (_, i) => ({
    name: i === 0 ? 'Старт' : `После шага ${i}`,
    jobs: jobs.filter((j) => level.get(j.name) === i),
  })).filter((s) => s.jobs.length);
}

function loadGithub(root, file) {
  const text = readText(root, file);
  const parsed = parseYaml(text, file);
  const data = parsed.data;
  const jobLines = parsed.nestedLines(['jobs']);
  const warnings = [];
  const jobsCfg = isPlainObject(data.jobs) ? data.jobs : {};
  if (!data.jobs) warnings.push('В файле нет раздела jobs');

  const jobs = Object.entries(jobsCfg).map(([id, cfg]) => {
    cfg = isPlainObject(cfg) ? cfg : {};
    const strategy = isPlainObject(cfg.strategy) ? cfg.strategy : null;
    const matrix = isPlainObject(strategy?.matrix)
      ? Object.entries(strategy.matrix)
          .filter(([k]) => k !== 'include' && k !== 'exclude')
          .map(([k, v]) => `${k}: ${asArray(v).join(', ')}`)
      : [];
    const env = cfg.environment;
    return {
      id,
      name: cfg.name ? String(cfg.name) : id,
      jobId: id,
      source: file,
      line: jobLines[id] ?? null,
      kind: cfg.uses ? 'trigger' : 'job',
      runsOn: cfg['runs-on'] ? asArray(cfg['runs-on']).join(', ') : null,
      image: cfg.container ? imageName(cfg.container) : null,
      condition: cfg.if != null ? String(cfg.if) : null,
      needs: cfg.needs ? asArray(cfg.needs).map((n) => ({ job: String(n) })) : null,
      allowFailure: cfg['continue-on-error'] === true,
      manual: false,
      environment: env ? (typeof env === 'string' ? { name: env } : { name: env.name, url: env.url ?? null }) : null,
      steps: asArray(cfg.steps).map((s, i) => ({
        name: s?.name ?? (s?.uses ? s.uses : s?.run ? String(s.run).split('\n')[0] : `Шаг ${i + 1}`),
        uses: s?.uses ?? null,
        run: s?.run != null ? String(s.run) : null,
        condition: s?.if != null ? String(s.if) : null,
        with: isPlainObject(s?.with) ? Object.entries(s.with).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`) : [],
      })),
      trigger: cfg.uses ? String(cfg.uses) : null,
      variables: variablesList(cfg.env),
      services: isPlainObject(cfg.services) ? Object.entries(cfg.services).map(([k, v]) => `${k} (${imageName(v) ?? '?'})`) : [],
      parallel: matrix.length ? `matrix: ${matrix.join('; ')}` : null,
      timeout: cfg['timeout-minutes'] != null ? `${cfg['timeout-minutes']} мин` : null,
      permissions: cfg.permissions ? toYaml(cfg.permissions) : null,
      outputs: isPlainObject(cfg.outputs) ? Object.keys(cfg.outputs) : [],
      extends: [],
      rules: [],
      raw: toYaml(cfg),
    };
  });
  for (const job of jobs) {
    for (const need of job.needs ?? []) {
      if (!jobs.some((j) => j.jobId === need.job)) warnings.push(`«${job.jobId}»: needs ссылается на «${need.job}», которого нет`);
    }
  }
  // needs ссылается на id заданий, а показываем name — сопоставим
  const byId = new Map(jobs.map((j) => [j.jobId, j]));
  for (const job of jobs) if (job.needs) job.needs = job.needs.map((n) => ({ job: byId.get(n.job)?.name ?? n.job }));

  const info = [];
  if (data.name) info.push({ label: 'Workflow', value: String(data.name) });
  if (data['run-name']) info.push({ label: 'Имя запуска', value: String(data['run-name']) });
  if (data.concurrency) info.push({ label: 'Concurrency', value: typeof data.concurrency === 'string' ? data.concurrency : data.concurrency.group ?? toYaml(data.concurrency) });
  if (data.permissions) info.push({ label: 'Права токена', value: typeof data.permissions === 'string' ? data.permissions : Object.entries(data.permissions).map(([k, v]) => `${k}: ${v}`).join(', ') });

  return {
    files: [{ path: file, text }],
    errors: parsed.errors,
    warnings,
    includes: [],
    info,
    triggers: githubTriggers(data.on ?? data[true]), // `on:` в YAML 1.1 иногда читается как true
    triggersTitle: 'Когда запускается (on)',
    variables: variablesList(data.env),
    pipelines: [{ id: 'main', title: data.name ? String(data.name) : file, stages: levelize(jobs, (j) => (j.needs ?? []).map((n) => n.job)) }],
    templates: [],
  };
}

/* =================== Bitbucket =================== */

function loadBitbucket(root, file) {
  const text = readText(root, file);
  const parsed = parseYaml(text, file);
  const data = parsed.data;
  const pipelinesCfg = isPlainObject(data.pipelines) ? data.pipelines : {};
  const definitions = isPlainObject(data.definitions) ? data.definitions : {};
  const defaultImage = imageName(data.image);
  const pipelines = [];
  let n = 0;

  const stepJob = (step, idx) => {
    const s = isPlainObject(step?.step) ? step.step : isPlainObject(step) ? step : {};
    n += 1;
    return {
      id: `s${n}`,
      name: s.name ? String(s.name) : `Шаг ${idx + 1}`,
      source: file,
      line: null,
      kind: 'job',
      image: imageName(s.image) ?? defaultImage,
      imageInherited: s.image ? false : defaultImage ? 'глобально' : false,
      manual: s.trigger === 'manual',
      when: s.trigger === 'manual' ? 'manual' : 'on_success',
      script: s.script ? { lines: scriptLines(s.script), inherited: false } : null,
      afterScript: s['after-script'] ? { lines: scriptLines(s['after-script']), inherited: false } : null,
      environment: s.deployment ? { name: s.deployment } : null,
      services: asArray(s.services).map(String),
      artifacts: s.artifacts ? { paths: asArray(isPlainObject(s.artifacts) ? s.artifacts.paths : s.artifacts).map(String), reports: [] } : null,
      cache: s.caches ? asArray(s.caches).join(', ') : null,
      variables: [],
      extends: [],
      rules: s.condition?.changesets ? [{ text: `изменены ${asArray(s.condition.changesets.includePaths).join(', ')}` }] : [],
      needs: null,
      raw: toYaml(s),
    };
  };

  const build = (title, list) => {
    const stages = [];
    asArray(list).forEach((item, i) => {
      if (isPlainObject(item) && item.parallel) {
        const steps = Array.isArray(item.parallel) ? item.parallel : asArray(item.parallel.steps);
        stages.push({ name: `Параллельно`, jobs: steps.map((s, k) => stepJob(s, k)) });
      } else if (isPlainObject(item) && item.stage) {
        stages.push({ name: item.stage.name ?? `Stage ${i + 1}`, jobs: asArray(item.stage.steps).map((s, k) => stepJob(s, k)) });
      } else {
        const job = stepJob(item, i);
        stages.push({ name: job.name, jobs: [job] });
      }
    });
    pipelines.push({ id: title, title, stages });
  };

  if (pipelinesCfg.default) build('default — все ветки', pipelinesCfg.default);
  for (const group of ['branches', 'tags', 'bookmarks', 'pull-requests', 'custom']) {
    if (!isPlainObject(pipelinesCfg[group])) continue;
    for (const [pattern, list] of Object.entries(pipelinesCfg[group])) build(`${group}: ${pattern}`, list);
  }

  const info = [];
  if (defaultImage) info.push({ label: 'Образ по умолчанию', value: defaultImage });
  if (definitions.services) info.push({ label: 'Сервисы', value: Object.keys(definitions.services).join(', ') });
  return {
    files: [{ path: file, text }],
    errors: parsed.errors,
    warnings: pipelines.length ? [] : ['Не найден раздел pipelines'],
    includes: [],
    info,
    triggers: pipelines.map((p) => ({ text: p.title })),
    triggersTitle: 'Пайплайны',
    variables: [],
    pipelines,
    templates: [],
  };
}

/* =================== CircleCI =================== */

function loadCircle(root, file) {
  const text = readText(root, file);
  const parsed = parseYaml(text, file);
  const data = parsed.data;
  const jobDefs = isPlainObject(data.jobs) ? data.jobs : {};
  const jobLines = parsed.nestedLines(['jobs']);
  const makeJob = (name, ref, opts = {}) => {
    const cfg = isPlainObject(jobDefs[ref]) ? jobDefs[ref] : {};
    const docker = asArray(cfg.docker);
    return {
      id: name,
      name,
      source: file,
      line: jobLines[ref] ?? null,
      // Задание approval — это ожидание ручного подтверждения, а не орб
      kind: jobDefs[ref] || opts.type === 'approval' ? 'job' : 'trigger',
      trigger: jobDefs[ref] || opts.type === 'approval' ? null : `orb: ${ref}`,
      image: docker[0] ? imageName(docker[0]) : cfg.machine ? 'machine' : cfg.macos ? 'macos' : null,
      manual: opts.type === 'approval',
      when: opts.type === 'approval' ? 'manual' : 'on_success',
      steps: asArray(cfg.steps).map((s) =>
        typeof s === 'string'
          ? { name: s, uses: null, run: null }
          : s?.run
            ? { name: typeof s.run === 'string' ? s.run.split('\n')[0] : s.run.name ?? 'run', uses: null, run: typeof s.run === 'string' ? s.run : s.run.command ?? null }
            : { name: Object.keys(s ?? {})[0] ?? 'step', uses: Object.keys(s ?? {})[0] ?? null, run: null },
      ),
      needs: opts.requires ? asArray(opts.requires).map((r) => ({ job: String(r) })) : null,
      rules: opts.filters ? [{ text: compact(opts.filters) }] : [],
      variables: variablesList(cfg.environment),
      extends: [],
      raw: toYaml(cfg),
    };
  };
  const pipelines = [];
  const workflows = isPlainObject(data.workflows) ? data.workflows : {};
  for (const [wfName, wf] of Object.entries(workflows)) {
    if (!isPlainObject(wf)) continue;
    const jobs = asArray(wf.jobs).map((entry) => {
      if (typeof entry === 'string') return makeJob(entry, entry);
      const [ref, opts] = Object.entries(entry)[0] ?? ['?', {}];
      return makeJob(opts?.name ?? ref, ref, opts ?? {});
    });
    pipelines.push({ id: wfName, title: wfName, stages: levelize(jobs, (j) => (j.needs ?? []).map((n) => n.job)) });
  }
  if (!pipelines.length && Object.keys(jobDefs).length) {
    pipelines.push({ id: 'jobs', title: 'jobs', stages: [{ name: 'Задания', jobs: Object.keys(jobDefs).map((k) => makeJob(k, k)) }] });
  }
  return {
    files: [{ path: file, text }],
    errors: parsed.errors,
    warnings: [],
    includes: data.orbs ? Object.entries(data.orbs).map(([k, v]) => ({ type: 'orb', value: `${k}: ${v}`, resolved: false })) : [],
    info: data.version ? [{ label: 'Версия конфига', value: String(data.version) }] : [],
    triggers: pipelines.map((p) => ({ text: `workflow ${p.title}` })),
    triggersTitle: 'Workflows',
    variables: [],
    pipelines,
    templates: [],
  };
}

/* =================== Azure Pipelines =================== */

function loadAzure(root, file) {
  const text = readText(root, file);
  const parsed = parseYaml(text, file);
  const data = parsed.data;
  let n = 0;
  const makeJob = (cfg) => {
    cfg = isPlainObject(cfg) ? cfg : {};
    n += 1;
    const name = cfg.displayName ?? cfg.job ?? cfg.deployment ?? cfg.template ?? `Job ${n}`;
    return {
      id: `j${n}`,
      name: String(name),
      source: file,
      line: null,
      kind: cfg.template ? 'trigger' : 'job',
      trigger: cfg.template ? `template: ${cfg.template}` : null,
      image: imageName(cfg.container) ?? (cfg.pool ? (typeof cfg.pool === 'string' ? cfg.pool : cfg.pool.vmImage ?? cfg.pool.name ?? null) : null),
      condition: cfg.condition ?? null,
      needs: cfg.dependsOn ? asArray(cfg.dependsOn).map((d) => ({ job: String(d) })) : null,
      environment: cfg.environment ? { name: typeof cfg.environment === 'string' ? cfg.environment : cfg.environment.name } : null,
      steps: asArray(cfg.steps ?? cfg.strategy?.runOnce?.deploy?.steps).map((s) => ({
        name: s?.displayName ?? s?.task ?? (s?.script ? String(s.script).split('\n')[0] : s?.bash ? String(s.bash).split('\n')[0] : 'step'),
        uses: s?.task ?? s?.template ?? null,
        run: s?.script ?? s?.bash ?? s?.powershell ?? s?.pwsh ?? null,
      })),
      variables: Array.isArray(cfg.variables) ? cfg.variables.filter((v) => v?.name).map((v) => ({ name: v.name, value: String(v.value ?? '') })) : variablesList(cfg.variables),
      extends: [],
      rules: [],
      manual: false,
      raw: toYaml(cfg),
    };
  };
  let stages;
  if (Array.isArray(data.stages)) {
    stages = data.stages.map((st, i) => ({ name: st?.displayName ?? st?.stage ?? `Stage ${i + 1}`, jobs: asArray(st?.jobs).map(makeJob) }));
  } else if (Array.isArray(data.jobs)) {
    const jobs = data.jobs.map(makeJob);
    const nameOf = new Map(data.jobs.map((j, i) => [j?.job ?? j?.deployment, jobs[i].name]));
    for (const j of jobs) if (j.needs) j.needs = j.needs.map((x) => ({ job: nameOf.get(x.job) ?? x.job }));
    stages = levelize(jobs, (j) => (j.needs ?? []).map((x) => x.job));
  } else {
    stages = [{ name: 'Шаги', jobs: [makeJob({ displayName: 'Задание', steps: data.steps, pool: data.pool })] }];
  }
  const triggers = [];
  if (data.trigger !== undefined) triggers.push({ text: `push: ${data.trigger === 'none' ? 'выключен' : compact(data.trigger)}` });
  if (data.pr !== undefined) triggers.push({ text: `pull request: ${data.pr === 'none' ? 'выключен' : compact(data.pr)}` });
  for (const s of asArray(data.schedules)) if (s?.cron) triggers.push({ text: `cron: ${s.cron}${s.displayName ? ` (${s.displayName})` : ''}` });
  return {
    files: [{ path: file, text }],
    errors: parsed.errors,
    warnings: [],
    includes: asArray(data.resources?.repositories).map((r) => ({ type: 'repository', value: `${r.repository}: ${r.name}`, resolved: false })),
    info: data.pool ? [{ label: 'Пул', value: typeof data.pool === 'string' ? data.pool : data.pool.vmImage ?? data.pool.name ?? toYaml(data.pool) }] : [],
    triggers,
    triggersTitle: 'Когда запускается',
    variables: Array.isArray(data.variables) ? data.variables.filter((v) => v?.name).map((v) => ({ name: v.name, value: String(v.value ?? '') })) : variablesList(data.variables),
    pipelines: [{ id: 'main', title: 'Пайплайн', stages }],
    templates: [],
  };
}

/* =================== Jenkins (Groovy) =================== */

// Достаём блок { ... } начиная с позиции открывающей скобки (с учётом строк и вложенности)
function extractBlock(text, openIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (text.startsWith(quote, i)) {
        i += quote.length - 1;
        quote = null;
      }
      continue;
    }
    if (text.startsWith("'''", i) || text.startsWith('"""', i)) {
      quote = text.slice(i, i + 3);
      i += 2;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '/' && text[i + 1] === '/') i = text.indexOf('\n', i) === -1 ? text.length : text.indexOf('\n', i);
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(openIndex + 1, i);
    }
  }
  return text.slice(openIndex + 1);
}

function dedent(block) {
  const lines = block.replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length));
  return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
}

function loadJenkins(root, file) {
  const text = readText(root, file).replace(/\r\n/g, '\n');
  const lineAt = (idx) => text.slice(0, idx).split('\n').length;

  // Все stage(...) { ... } с границами блоков — чтобы понять вложенность
  const all = [];
  const re = /\bstage\s*\(\s*(['"])(.+?)\1\s*\)\s*\{/g;
  let m;
  while ((m = re.exec(text))) {
    const open = m.index + m[0].length - 1;
    const body = extractBlock(text, open);
    all.push({ name: m[2], start: m.index, end: open + body.length + 1, body });
  }
  const inside = (a, b) => a !== b && a.start > b.start && a.end <= b.end;
  for (const st of all) {
    st.children = all.filter((x) => inside(x, st) && !all.some((y) => inside(x, y) && inside(y, st)));
    // Свой текст этапа — без вложенных этапов
    let own = st.body;
    for (const child of st.children) own = own.replace(text.slice(child.start, child.end), '');
    st.own = own;
  }

  const blockOf = (body, keyword) => {
    const idx = body.search(new RegExp(`\\b${keyword}\\s*\\{`));
    return idx === -1 ? null : dedent(extractBlock(body, body.indexOf('{', idx)));
  };

  const makeJob = (st) => {
    const steps = blockOf(st.own, 'steps') ?? [];
    const when = blockOf(st.own, 'when') ?? [];
    const agent = /\bagent\s*\{([^}]*)\}/.exec(st.own)?.[1]?.trim() ?? /\bagent\s+(\w+)/.exec(st.own)?.[1] ?? null;
    const manual = /\binput\b\s*[('"{]/.test(st.own);
    return {
      id: `st${all.indexOf(st)}`,
      name: st.name,
      source: file,
      line: lineAt(st.start),
      kind: 'job',
      image: agent ? agent.replace(/\s+/g, ' ') : null,
      manual,
      when: manual ? 'manual' : 'on_success',
      script: steps.length ? { lines: steps, inherited: false } : null,
      rules: when.filter((l) => l.trim()).map((l) => ({ text: l.trim() })),
      variables: [],
      extends: [],
      needs: null,
      raw: text.slice(st.start, st.end),
    };
  };

  const leaves = (st) => (st.children.length ? st.children.flatMap(leaves) : [st]);
  const columns = [];
  for (const st of all.filter((x) => !all.some((y) => inside(x, y)))) {
    if (!st.children.length) columns.push({ name: st.name, jobs: [makeJob(st)] });
    else if (/\bparallel\s*\{/.test(st.own)) columns.push({ name: `${st.name} · параллельно`, jobs: leaves(st).map(makeJob) });
    else for (const leaf of leaves(st)) columns.push({ name: `${st.name} › ${leaf.name}`, jobs: [makeJob(leaf)] });
  }

  const info = [];
  const agent = /^\s*agent\s+(\w+|\{[^}]*\})/m.exec(text)?.[1];
  if (agent) info.push({ label: 'Агент', value: agent.replace(/\s+/g, ' ') });
  if (/^\s*pipeline\s*\{/m.test(text)) info.push({ label: 'Синтаксис', value: 'Declarative Pipeline' });
  else if (/\bnode\s*[({]/.test(text)) info.push({ label: 'Синтаксис', value: 'Scripted Pipeline' });
  const triggers = (blockOf(text, 'triggers') ?? []).filter((l) => l.trim()).map((l) => ({ text: l.trim() }));
  return {
    files: [{ path: file, text }],
    errors: [],
    warnings: columns.length ? [] : ['Не удалось найти этапы stage(...) — показан только файл'],
    includes: [...text.matchAll(/@Library\(\s*['"]([^'"]+)['"]/g)].map((x) => ({ type: 'library', value: x[1], resolved: false })),
    info,
    triggers,
    triggersTitle: 'Триггеры',
    variables: [],
    pipelines: [{ id: 'main', title: 'Pipeline', stages: columns }],
    templates: [],
  };
}

/* =================== Остальные — только файл =================== */

function loadGeneric(root, file) {
  const text = readText(root, file);
  const parsed = parseYaml(text, file);
  return {
    files: [{ path: file, text }],
    errors: parsed.errors,
    warnings: [],
    includes: [],
    info: Object.keys(parsed.data).length ? [{ label: 'Разделы', value: Object.keys(parsed.data).join(', ') }] : [],
    triggers: [],
    triggersTitle: '',
    variables: [],
    pipelines: [],
    templates: [],
    schemeUnsupported: true,
  };
}

const LOADERS = {
  gitlab: loadGitlab,
  github: loadGithub,
  bitbucket: loadBitbucket,
  circleci: loadCircle,
  azure: loadAzure,
  jenkins: loadJenkins,
};

/* =================== История и состояние =================== */

async function ciHistory(root, paths) {
  if (!paths.length || !(await hasHead(root))) return [];
  const out = await git(root, ['log', '-n', '50', `--format=%H${FS}%s${FS}%an${FS}%aI`, '--', ...paths]).catch(() => '');
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, message, author, date] = line.split(FS);
      return { hash, message, author, date };
    });
}

async function dirtyFiles(root, paths) {
  if (!paths.length) return [];
  const out = await git(root, ['status', '--porcelain', '-z', '--untracked-files=all', '--', ...paths]).catch(() => '');
  return out
    .split('\0')
    .filter((e) => e.length > 3)
    .map((e) => ({ path: e.slice(3), status: e.slice(0, 2).trim() || 'M' }));
}

/** Полный разбор одного файла CI (и подключённых к нему локальных файлов) */
/** Разбор с черновиками вместо файлов на диске — для живого предпросмотра при редактировании */
async function previewCi(root, requestedFile, drafts) {
  overrides = new Map(Object.entries(drafts ?? {}).filter(([, v]) => typeof v === 'string').map(([k, v]) => [normRel(k), v]));
  try {
    return await loadCi(root, requestedFile, { skipHistory: true });
  } finally {
    overrides = null;
  }
}

async function loadCi(root, requestedFile, { skipHistory = false } = {}) {
  const systems = detectCi(root);
  if (!systems.length) return { systems, current: null };
  let system = systems.find((s) => s.files.includes(requestedFile)) ?? systems[0];
  const file = system.files.includes(requestedFile) ? requestedFile : system.files[0];

  let result;
  try {
    // Разбор синхронный — черновики (overrides) действуют ровно на время этого вызова
    result = (LOADERS[system.id] ?? loadGeneric)(root, file);
  } catch (error) {
    result = {
      files: [],
      errors: [{ file, message: error.message, line: null, severity: 'error' }],
      warnings: [],
      includes: [],
      info: [],
      triggers: [],
      variables: [],
      pipelines: [],
      templates: [],
    };
  }

  const trackedPaths = [...new Set([...systems.flatMap((s) => s.files), ...result.files.map((f) => f.path)])];
  const drafts = overrides;
  overrides = null; // дальше — асинхронно; черновики больше не нужны
  const [history, dirty] = skipHistory ? [[], []] : await Promise.all([ciHistory(root, trackedPaths), dirtyFiles(root, trackedPaths)]);
  // Отпечаток файла на диске — чтобы при сохранении заметить, что его поменяли снаружи
  for (const f of result.files) {
    const disk = ciEdit.readFile(root, f.path);
    f.hash = disk.hash;
    f.draft = Boolean(drafts?.has(normRel(f.path)));
  }
  // Проверка конфигурации: что сломается и почему
  const check = await checkCi(root, system.id, result).catch((error) => ({ issues: [], scenarios: [], stats: { error: 0, warning: 0, info: 0 }, failed: String(error?.message ?? error) }));
  delete result._raw;
  const jobCount = result.pipelines.reduce((n, p) => n + p.stages.reduce((k, s) => k + s.jobs.length, 0), 0);

  return {
    systems,
    current: { system: system.id, title: system.title, file, jobCount, ...result, history, dirty, check },
  };
}

module.exports = { detectCi, loadCi, previewCi };
