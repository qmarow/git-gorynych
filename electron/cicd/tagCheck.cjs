// Сверка конфига CI с живыми раннерами: задание с tags (GitLab) или runs-on (GitHub, Gitea, Bitbucket),
// которое не возьмёт ни один раннер в сети, повиснет в очереди (Pending).
const { Positions } = require('../ciCheckBase.cjs');
const { t: tr } = require('../i18n.cjs');

const low = (s) => String(s).trim().toLowerCase();
const isLive = (r) => r.status === 'online' || r.status === 'busy';
const q = (s) => `«${s}»`;

/** Метки задания и где они записаны → [{ job, tags, file, keyPath, untagged }] */
function requirements(current, provider) {
  const out = [];
  const seen = new Set();
  for (const p of current.pipelines ?? []) {
    for (const st of p.stages ?? []) {
      for (const job of st.jobs ?? []) {
        const key = `${job.source}|${job.id}`;
        if (seen.has(key) || job.kind === 'trigger') continue;
        seen.add(key);
        if (current.system === 'gitlab') {
          out.push({ job: job.name, tags: job.tags ?? [], file: job.source, keyPath: [job.name, 'tags'], line: job.line, untagged: !(job.tags ?? []).length });
        } else if (['github', 'gitea', 'forgejo'].includes(current.system)) {
          if (!job.runsOnLabels?.length) continue;
          // Выражения ${{ matrix.os }} заранее не вычислить — пропускаем
          if (job.runsOnLabels.some((l) => /\$\{\{/.test(l))) continue;
          out.push({ job: job.name, tags: job.runsOnLabels, file: job.source, keyPath: ['jobs', job.jobId ?? job.id, 'runs-on'], line: job.line });
        } else if (current.system === 'bitbucket' && job.runsOnLabels?.length) {
          out.push({ job: job.name, tags: job.runsOnLabels, file: job.source, keyPath: null, line: job.line, text: 'runs-on' });
        }
      }
    }
  }
  return out;
}

/** Метки, которые есть у раннера (GitHub: self-hosted и ОС/архитектура — тоже метки) */
const labelSet = (r) => new Set(r.labels.map(low));

function checkRunnerTags(current, runners, { provider } = {}) {
  const issues = [];
  const pos = new Positions(current.files ?? []);
  const reqs = requirements(current, provider);
  const groups = new Map();
  for (const r of reqs) {
    const k = r.untagged ? '\u0000' : r.tags.map(low).sort().join('|');
    if (!groups.has(k)) groups.set(k, { ...r, jobs: [] });
    groups.get(k).jobs.push(r.job);
  }
  const jobsText = (jobs) => `${jobs.slice(0, 4).map(q).join(', ')}${jobs.length > 4 ? tr(' и ещё {0}', jobs.length - 4) : ''}`;
  for (const g of groups.values()) {
    const line = (g.keyPath ? pos.line(g.file, g.keyPath) : null) ?? (g.text ? pos.find?.(g.file, g.text) : null) ?? g.line ?? null;
    const base = { file: g.file, line, job: g.jobs[0], source: 'runners' };
    if (g.untagged) {
      // GitLab: задание без тегов берёт только раннер с «Run untagged jobs»
      const any = runners.filter((r) => r.runUntagged !== false);
      const live = any.filter(isLive);
      if (!live.length) {
        issues.push({
          ...base,
          id: 'runner-untagged',
          severity: 'warning',
          title: any.length ? tr('Все раннеры для заданий без тегов не в сети или на паузе') : tr('Нет раннера, который берёт задания без тегов'),
          when: tr('При запуске {0}', jobsText(g.jobs)),
          how: tr('Задание повиснет в очереди (Pending): «This job is stuck because the project doesn’t have any runners online assigned to it».'),
          why: any.length ? tr('Подходят: {0}', any.map((r) => `${r.name} (${STATUS[r.status] ?? r.status})`).join(', ')) : tr('У всех раннеров проекта выключено «Run untagged jobs».'),
          fix: tr('Добавьте заданию tags: [<тег живого раннера>] или включите раннеру «Брать задания без тегов».'),
        });
      }
      continue;
    }
    const need = g.tags.map(low);
    // GitHub: ubuntu-latest и другие облачные раннеры — в списке как общие (виртуальные)
    const fit = runners.filter((r) => need.every((t) => labelSet(r).has(t)));
    const live = fit.filter(isLive);
    if (live.length) continue;
    const allLabels = new Set(runners.filter(isLive).flatMap((r) => r.labels.map(low)));
    const missing = g.tags.filter((t) => !allLabels.has(low(t)));
    const what = missing.length === 1 ? tr('тегом "{0}"', missing[0]) : missing.length ? tr('тегами {0}', missing.map((t) => `"${t}"`).join(', ')) : tr('набором тегов {0}', g.tags.map((t) => `"${t}"`).join(', '));
    let why;
    if (fit.length) why = tr('Раннеры с этими тегами есть, но {0}.', fit.map((r) => `${r.name} — ${STATUS[r.status] ?? r.status}`).join(', '));
    else if (!missing.length) why = tr('Каждый тег есть у какого-то раннера в сети, но ни у одного — все сразу: задание берёт только раннер, у которого есть все перечисленные теги.');
    else why = tr('Ни у одного раннера в сети нет {0}.', missing.length === 1 ? tr('этого тега') : tr('этих тегов'));
    issues.push({
      ...base,
      id: 'runner-tags-missing',
      severity: 'warning',
      title: tr('Нет активных раннеров с {0} — пайплайн зависнет в очереди (Pending)!', what),
      when: tr('При запуске {0}', jobsText(g.jobs)),
      how:
        current.system === 'gitlab'
          ? 'GitLab: «This job is stuck because you don’t have any active runners online … with any of these tags assigned to them».'
          : tr('Задание будет ждать в статусе Queued, пока не появится подходящий раннер (до 24 часов), затем отменится.'),
      why,
      fix: fit.length ? tr('Запустите или снимите с паузы подходящий раннер (вкладка «Раннеры»).') : tr('Проверьте опечатки в тегах или подключите раннер с этими тегами (вкладка «Раннеры» → «Подключить раннер»).'),
      tags: g.tags,
      missing,
    });
  }
  return issues;
}

const STATUS = { get online() {
    return tr('в сети');
  }, get busy() {
    return tr('занят');
  }, get offline() {
    return tr('не в сети');
  }, get paused() {
    return tr('на паузе');
  } };

module.exports = { checkRunnerTags, requirements };
