// Интерактивный rebase с предпросмотром.
// План (pick / reword / squash / fixup / drop + порядок) сначала «проигрывается» целиком в памяти:
// git merge-tree считает результат каждого шага, git commit-tree создаёт новые коммиты — рабочая папка,
// индекс и ветки не трогаются. Пользователь видит итоговый граф и diff, а «Применить» просто переводит
// ветку на уже посчитанный результат (ровно то, что было в предпросмотре).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { git, readStatus, detectOperation, getCommitFiles, HASH_RE } = require('./git.cjs');
const { GitError } = require('./errors.cjs');

const ACTIONS = new Set(['pick', 'reword', 'squash', 'fixup', 'drop']);
const FS = '\x1f';
const RS = '\x1e';
const MAX_COMMITS = 300;

/* ---------------- Общие проверки ---------------- */

async function headHash(cwd) {
  return (await git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']).catch(() => '')).trim() || null;
}

async function resolveCommit(cwd, ref, what) {
  if (typeof ref !== 'string' || !ref.trim() || ref.startsWith('-')) throw new GitError(`Не указан ${what}`, { code: 'BAD_ARGS' });
  const hash = (await git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).catch(() => '')).trim();
  if (!hash) throw new GitError(`Не найдено: ${ref}`, { code: 'NOT_FOUND_REF' });
  return hash;
}

async function requireBranchState(cwd) {
  if (await detectOperation(cwd)) {
    throw new GitError('Сначала завершите текущую операцию (merge / rebase / cherry-pick)', {
      code: 'OPERATION_IN_PROGRESS',
      hint: 'Продолжите или прервите её в жёлтой панели сверху.',
    });
  }
  const head = await headHash(cwd);
  if (!head) throw new GitError('В репозитории ещё нет коммитов', { code: 'NO_COMMITS' });
  const branch = (await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim() || null;
  if (!branch) {
    throw new GitError('Rebase делается для ветки, а сейчас detached HEAD', {
      code: 'DETACHED',
      hint: 'Переключитесь на ветку, историю которой хотите изменить.',
    });
  }
  return { head, branch };
}

function readCommitList(out) {
  return out
    .split(RS)
    .map((r) => r.replace(/^\n/, ''))
    .filter(Boolean)
    .map((r) => {
      const [hash, parents, authorName, authorEmail, authorDate, body] = r.split(FS);
      const message = (body ?? '').replace(/\s+$/, '');
      return {
        hash,
        parents: parents ? parents.split(' ') : [],
        author: { name: authorName, email: authorEmail, date: authorDate },
        message,
        subject: message.split('\n')[0],
      };
    });
}

const LOG_FORMAT = `--format=%H${FS}%P${FS}%an${FS}%ae${FS}%aI${FS}%B${RS}`;

async function commitInfo(cwd, hash) {
  return readCommitList(await git(cwd, ['log', '-1', LOG_FORMAT, hash]))[0];
}

/* ---------------- Что будет перебазироваться ---------------- */

// Как это делает сам git rebase: коммиты ветки, которых нет в upstream (без merge-коммитов и без уже
// перенесённых туда же изменений), от старых к новым
async function scope(cwd, upstreamRef, ontoRef) {
  const { head, branch } = await requireBranchState(cwd);
  const upstream = await resolveCommit(cwd, upstreamRef, 'коммит');
  const onto = ontoRef ? await resolveCommit(cwd, ontoRef, 'коммит') : upstream;
  if (upstream === head) throw new GitError('Это и есть последний коммит ветки — после него нечего менять', { code: 'UP_TO_DATE' });

  const out = await git(cwd, ['log', '--reverse', '--topo-order', '--no-merges', '--cherry-pick', '--right-only', LOG_FORMAT, `${upstream}...${head}`]);
  const commits = readCommitList(out);
  const merges = Number((await git(cwd, ['rev-list', '--count', '--merges', `${upstream}..${head}`])).trim());
  const isAncestor = await git(cwd, ['merge-base', '--is-ancestor', upstream, head]).then(() => true, () => false);
  if (commits.length > MAX_COMMITS) {
    throw new GitError(`Слишком много коммитов для rebase: ${commits.length}`, {
      code: 'TOO_MANY',
      hint: `Выберите точку поближе (не больше ${MAX_COMMITS} коммитов).`,
    });
  }
  return { head, branch, upstream, onto, commits, merges, isAncestor };
}

/* ---------------- Симуляция ---------------- */

async function treeOf(cwd, commit) {
  return (await git(cwd, ['rev-parse', `${commit}^{tree}`])).trim();
}

let mergeTreeChecked = false;

// Результат «cherry-pick» коммита theirs поверх ours в памяти. base — родитель переносимого коммита.
async function mergeTree(cwd, base, ours, theirs) {
  try {
    const out = await git(cwd, ['merge-tree', '--write-tree', '--name-only', `--merge-base=${base}`, ours, theirs]);
    mergeTreeChecked = true;
    return { ok: true, tree: out.split('\n')[0].trim() };
  } catch (error) {
    const out = error.stdout ?? '';
    const first = out.split('\n')[0].trim();
    if (/^[0-9a-f]{40,64}$/.test(first)) {
      // Конфликт: дальше идут имена файлов, пустая строка, затем пояснения git
      const [names, messages = ''] = out.slice(first.length + 1).split(/\n\n/);
      return {
        ok: false,
        files: [...new Set(names.split('\n').map((s) => s.trim()).filter(Boolean))],
        messages: messages.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 20),
      };
    }
    if (!mergeTreeChecked && /merge-base|write-tree|usage|unknown/i.test(`${error.details}`)) {
      throw new GitError('Для предпросмотра rebase нужен Git 2.40 или новее', {
        code: 'GIT_TOO_OLD',
        hint: 'Обновите Git for Windows (git-scm.com) и перезапустите приложение.',
        details: error.details,
      });
    }
    throw error;
  }
}

async function commitTree(cwd, tree, parent, author, message) {
  const out = await git(cwd, ['commit-tree', tree, '-p', parent, '-m', message], {
    env: { GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_AUTHOR_DATE: author.date },
  });
  return out.trim();
}

function validatePlan(commits, plan) {
  if (!Array.isArray(plan) || plan.length !== commits.length) {
    throw new GitError('План устарел — список коммитов изменился', { code: 'PLAN_STALE', hint: 'Откройте rebase заново.' });
  }
  const known = new Set(commits.map((c) => c.hash));
  const seen = new Set();
  for (const item of plan) {
    if (!item || !HASH_RE.test(item.hash ?? '') || !known.has(item.hash) || seen.has(item.hash)) {
      throw new GitError('План устарел — список коммитов изменился', { code: 'PLAN_STALE', hint: 'Откройте rebase заново.' });
    }
    if (!ACTIONS.has(item.action)) throw new GitError(`Неизвестное действие: ${item.action}`, { code: 'BAD_ARGS' });
    if (item.message != null && (typeof item.message !== 'string' || !item.message.trim())) {
      throw new GitError('Сообщение коммита не может быть пустым', { code: 'EMPTY_MESSAGE' });
    }
    seen.add(item.hash);
  }
  const kept = plan.filter((i) => i.action !== 'drop');
  if (kept[0] && (kept[0].action === 'squash' || kept[0].action === 'fixup')) {
    throw new GitError('Первый коммит не с чем объединить', {
      code: 'BAD_PLAN',
      hint: 'Squash и fixup присоединяют коммит к предыдущему — у самого первого предыдущего нет.',
    });
  }
}

// Группы: коммит + присоединённые к нему squash/fixup
function groupsOf(plan, byHash) {
  const groups = [];
  for (const item of plan) {
    if (item.action === 'drop') continue;
    const c = byHash.get(item.hash);
    if (item.action === 'squash' || item.action === 'fixup') groups.at(-1).members.push({ item, c });
    else groups.push({ head: { item, c }, members: [{ item, c }] });
  }
  return groups;
}

// Сообщение итогового коммита группы: явное (если пользователь его правил) или как сделал бы git
function groupMessage(g) {
  if (g.head.item.message) return g.head.item.message.replace(/\s+$/, '');
  const parts = [g.head.c.message];
  for (const m of g.members.slice(1)) if (m.item.action === 'squash') parts.push(m.c.message);
  return parts.join('\n\n');
}

async function simulate(cwd, { upstream: upstreamRef, onto: ontoRef, plan: rawPlan }) {
  const sc = await scope(cwd, upstreamRef, ontoRef);
  const byHash = new Map(sc.commits.map((c) => [c.hash, c]));
  const plan = rawPlan ?? sc.commits.map((c) => ({ hash: c.hash, action: 'pick' }));
  validatePlan(sc.commits, plan);
  const groups = groupsOf(plan, byHash);

  const after = [];
  const skipped = plan.filter((i) => i.action === 'drop').map((i) => ({ ...brief(byHash.get(i.hash)), reason: 'drop' }));
  let cur = sc.onto;
  let conflict = null;

  for (let gi = 0; gi < groups.length && !conflict; gi++) {
    const g = groups[gi];
    const base = cur;
    let work = base;
    let tree = null;
    for (let mi = 0; mi < g.members.length; mi++) {
      const { item, c } = g.members[mi];
      if (!c.parents.length) {
        throw new GitError('Нельзя перенести самый первый коммит репозитория', { code: 'ROOT_COMMIT' });
      }
      // Коммит остаётся на своём месте без изменений — git переиспользует его как есть
      if (g.members.length === 1 && item.action !== 'reword' && !item.message && c.parents[0] === work) {
        tree = null;
        work = c.hash;
        break;
      }
      const r = await mergeTree(cwd, c.parents[0], work, c.hash);
      if (!r.ok) {
        conflict = { ...brief(c), action: item.action, files: r.files, messages: r.messages, index: plan.findIndex((p) => p.hash === c.hash) };
        break;
      }
      tree = r.tree;
      // Промежуточный коммит нужен только как «ours» для следующего шага группы
      if (mi < g.members.length - 1) work = await commitTree(cwd, tree, base, c.author, 'squash step');
    }
    if (conflict) break;

    if (tree === null) {
      // переиспользован исходный коммит
      const c = g.head.c;
      after.push({ ...brief(c), action: 'pick', origs: [c.hash], reused: true });
      cur = work;
      continue;
    }
    if (tree === (await treeOf(cwd, base))) {
      // Изменения уже есть в новой основе — git такой коммит пропускает
      for (const m of g.members) skipped.push({ ...brief(m.c), reason: 'empty' });
      continue;
    }
    const message = groupMessage(g);
    const hash = await commitTree(cwd, tree, base, g.head.c.author, message);
    after.push({
      hash,
      subject: message.split('\n')[0],
      message,
      author: g.head.c.author,
      action: g.members.length > 1 ? (g.members.slice(1).some((m) => m.item.action === 'squash') ? 'squash' : 'fixup') : g.head.item.action,
      origs: g.members.map((m) => m.c.hash),
      reused: false,
    });
    cur = hash;
  }

  const result = {
    branch: sc.branch,
    oldHead: sc.head,
    upstream: brief(await commitInfo(cwd, sc.upstream)),
    onto: brief(await commitInfo(cwd, sc.onto)),
    interactiveFromAncestor: sc.isAncestor && sc.onto === sc.upstream,
    merges: sc.merges,
    before: sc.commits.map(brief),
    plan,
    ok: !conflict,
    conflict,
    after,
    skipped,
    newHead: conflict ? null : cur,
    unchanged: !conflict && cur === sc.head,
  };

  if (!conflict) {
    result.diff = cur === sc.head ? [] : await getCommitFiles(cwd, cur, sc.head);
    result.identicalFiles = (await treeOf(cwd, cur)) === (await treeOf(cwd, sc.head));
  }
  // Переписанные коммиты, которые уже есть на сервере: после rebase понадобится force push
  const rewritten = sc.commits.filter((c) => !after.some((a) => a.reused && a.hash === c.hash));
  result.pushed = await countPushed(cwd, rewritten.map((c) => c.hash));
  result.dirty = (await readStatus(cwd)).filter((f) => !f.untracked).length;
  return result;
}

const brief = (c) => ({ hash: c.hash, subject: c.subject, message: c.message, author: c.author });

async function countPushed(cwd, hashes) {
  if (!hashes.length) return 0;
  const remotes = (await git(cwd, ['for-each-ref', '--format=%(objectname)', 'refs/remotes'])).split('\n').filter(Boolean);
  if (!remotes.length) return 0;
  const out = await git(cwd, ['rev-list', '--no-walk=unsorted', ...hashes, '--not', '--remotes']).catch(() => '');
  const unpushed = new Set(out.split('\n').filter(Boolean));
  return hashes.filter((h) => !unpushed.has(h)).length;
}

/* ---------------- Применение посчитанного результата ---------------- */

async function apply(cwd, { oldHead, newHead, branch, onto }) {
  if (!HASH_RE.test(oldHead ?? '') || !HASH_RE.test(newHead ?? '') || !HASH_RE.test(onto ?? '')) {
    throw new GitError('Некорректный предпросмотр', { code: 'BAD_ARGS' });
  }
  const st = await requireBranchState(cwd);
  if (st.head !== oldHead || st.branch !== branch) {
    throw new GitError('Ветка изменилась после предпросмотра', { code: 'PLAN_STALE', hint: 'Предпросмотр обновится — проверьте его и примените снова.' });
  }
  if (newHead === oldHead) throw new GitError('Ничего не меняется', { code: 'UP_TO_DATE' });
  // Результат должен быть посчитан поверх выбранной основы
  const ok = await git(cwd, ['merge-base', '--is-ancestor', onto, newHead]).then(() => true, () => false);
  if (!ok) throw new GitError('Некорректный результат предпросмотра', { code: 'BAD_ARGS' });
  try {
    // --keep переносит ветку и обновляет файлы, но не трогает несвязанные локальные правки
    await git(cwd, ['reset', '--keep', newHead], { env: { GIT_REFLOG_ACTION: `rebase (предпросмотр): ${branch}` } });
  } catch (error) {
    if (/not uptodate|would be overwritten|cannot merge|local changes/i.test(`${error.details}`)) {
      throw new GitError('Незакоммиченные правки в файлах, которые меняет rebase', {
        code: 'DIRTY',
        hint: 'Закоммитьте их или сделайте Stash, затем примените rebase.',
        details: error.details,
      });
    }
    throw error;
  }
  await git(cwd, ['update-ref', 'ORIG_HEAD', oldHead]).catch(() => {});
  return { branch, from: oldHead, to: newHead };
}

/* ---------------- Настоящий git rebase -i (когда есть конфликты) ---------------- */

// Скрипты-«редакторы» для git: подставляют наш список действий и новые сообщения коммитов
const EDITOR_JS = `
const fs = require('fs');
const [mode, dataFile, target] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
if (mode === 'todo') { fs.writeFileSync(target, data.todo); process.exit(0); }
const text = fs.readFileSync(target, 'utf8');
const plain = text.split(/\\r?\\n/).filter((l) => !l.startsWith('#')).join('\\n').trim();
const i = data.messages.findIndex((m) => plain === m.match || plain.startsWith(m.match + '\\n'));
if (i !== -1) {
  fs.writeFileSync(target, data.messages[i].message + '\\n');
  data.messages.splice(i, 1); // одинаковые сообщения у разных коммитов — по очереди
  fs.writeFileSync(dataFile, JSON.stringify(data));
}
`;

const sessions = new Map(); // repo → { dir, env } — нужен и при «Продолжить» после конфликтов

function shQuote(p) {
  return `'${p.replace(/\\/g, '/').replace(/'/g, `'\\''`)}'`;
}

function editorEnv(dir) {
  const node = shQuote(process.execPath);
  const script = shQuote(path.join(dir, 'editor.js'));
  const data = shQuote(path.join(dir, 'plan.json'));
  return {
    ELECTRON_RUN_AS_NODE: '1',
    GIT_SEQUENCE_EDITOR: `${node} ${script} todo ${data}`,
    GIT_EDITOR: `${node} ${script} msg ${data}`,
  };
}

async function start(cwd, { upstream: upstreamRef, onto: ontoRef, plan }) {
  const sc = await scope(cwd, upstreamRef, ontoRef);
  validatePlan(sc.commits, plan);
  const byHash = new Map(sc.commits.map((c) => [c.hash, c]));
  const groups = groupsOf(plan, byHash);

  const lines = [];
  const messages = [];
  for (const g of groups) {
    const hasSquash = g.members.slice(1).some((m) => m.item.action === 'squash');
    const custom = g.head.item.message ?? (g.head.item.action === 'reword' ? g.head.c.message : null);
    const needMessage = Boolean(custom) || hasSquash;
    // Новое сообщение спрашивается редактором в конце группы: reword (без squash) или последний squash
    lines.push(`${custom && !hasSquash ? 'reword' : 'pick'} ${g.head.c.hash}`);
    for (const m of g.members.slice(1)) lines.push(`${m.item.action === 'squash' ? 'squash' : 'fixup'} ${m.c.hash}`);
    if (needMessage) messages.push({ match: g.head.c.message.trim(), message: groupMessage(g) });
  }
  for (const item of plan) if (item.action === 'drop') lines.push(`drop ${item.hash}`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gk-rebase-'));
  fs.writeFileSync(path.join(dir, 'editor.js'), EDITOR_JS);
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify({ todo: `${lines.join('\n')}\n`, messages }));
  const env = editorEnv(dir);
  sessions.set(cwd, { dir, env });

  const args = ['rebase', '-i', '--empty=drop', '--no-autosquash'];
  if (sc.onto !== sc.upstream) args.push('--onto', sc.onto);
  args.push(sc.upstream);
  try {
    await git(cwd, args, { env: { ...env, GIT_REFLOG_ACTION: 'rebase (interactive)' } });
  } catch (error) {
    if (await detectOperation(cwd)) {
      throw new GitError('Rebase остановился на конфликте', {
        code: 'CONFLICT',
        hint: 'Разрешите конфликты в файлах и нажмите «Продолжить» в жёлтой панели сверху. «Прервать» вернёт всё как было.',
        details: error.details,
      });
    }
    cleanup(cwd);
    throw error;
  }
  cleanup(cwd);
  return { branch: sc.branch, from: sc.head, to: await headHash(cwd) };
}

// Окружение для `git rebase --continue`, чтобы reword/squash после конфликта получили нужные сообщения
function continueEnv(cwd) {
  return sessions.get(cwd)?.env ?? null;
}

function cleanup(cwd) {
  const s = sessions.get(cwd);
  if (!s) return;
  sessions.delete(cwd);
  try {
    fs.rmSync(s.dir, { recursive: true, force: true });
  } catch {
    /* не страшно */
  }
}

module.exports = { simulate, apply, start, continueEnv, cleanup };
