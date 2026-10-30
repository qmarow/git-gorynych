// Лёгкая фоновая проверка сервера: «изменилось ли что-нибудь?» — и fetch только если да.
//
// 1. Хэши веток на сервере: GitLab API с ETag (если есть токен) или git ls-remote --heads --tags.
// 2. Сравнение с локальными refs/remotes/<remote>/* (и тегами).
// 3. Только при расхождении — настоящий git fetch --prune <remote>.
//
// Ничего не пишет в .git, пока сервер не изменился; никогда не запускается параллельно действию пользователя.
const fs = require('node:fs');
const path = require('node:path');
const { git } = require('./git.cjs');
const gitlab = require('./gitlab.cjs');
const { isBusy, runBackground, networkOptions } = require('./actions.cjs');

const LS_REMOTE_TIMEOUT = 8000;
const FETCH_TIMEOUT = 2 * 60 * 1000;
const API_COOLDOWN = 10 * 60 * 1000; // токен не подошёл — API не трогаем 10 минут, работаем через ls-remote
const MAX_REMOTES = 3;
const FS = '\x1f';

const gitDirs = new Map(); // root → абсолютный путь к .git
const apiOff = new Map(); // root|remote → до какого времени не пробовать API
const lastSig = new Map(); // root|remote → подпись расхождения, после которой fetch ничего не исправил

async function gitDir(root) {
  if (!gitDirs.has(root)) {
    const dir = (await git(root, ['rev-parse', '--absolute-git-dir'])).trim();
    gitDirs.set(root, dir);
  }
  return gitDirs.get(root);
}

/** Окружение для фоновых сетевых команд: никаких окон входа и вопросов */
async function quietEnv(root, timeout) {
  const opts = await networkOptions(root);
  return { env: { ...opts.env, GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '' }, timeout };
}

function parseLsRemote(out) {
  const heads = new Map();
  const tags = new Map();
  for (const line of out.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const hash = line.slice(0, tab).trim();
    const ref = line.slice(tab + 1).trim();
    if (ref.startsWith('refs/heads/')) heads.set(ref.slice(11), hash);
    else if (ref.startsWith('refs/tags/') && !ref.endsWith('^{}')) tags.set(ref.slice(10), hash);
  }
  return { heads, tags };
}

async function localState(root, remote) {
  const out = await git(root, ['for-each-ref', `--format=%(objectname)${FS}%(refname)`, `refs/remotes/${remote}/`, 'refs/tags/']);
  const heads = new Map();
  const tags = new Set();
  const prefix = `refs/remotes/${remote}/`;
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [hash, ref] = line.split(FS);
    if (ref.startsWith(prefix)) {
      const name = ref.slice(prefix.length);
      if (name !== 'HEAD') heads.set(name, hash);
    } else if (ref.startsWith('refs/tags/')) tags.add(ref.slice(10));
  }
  return { heads, tags };
}

/** Какие remote проверять: за которыми следят локальные ветки, плюс origin */
async function remotesToCheck(root) {
  const all = (await git(root, ['remote'])).split('\n').filter(Boolean);
  if (!all.length) return [];
  const tracked = (await git(root, ['for-each-ref', '--format=%(upstream:remotename)', 'refs/heads']))
    .split('\n')
    .filter((r) => r && all.includes(r));
  const order = [...new Set([...tracked, ...(all.includes('origin') ? ['origin'] : []), all[0]])];
  return order.slice(0, MAX_REMOTES);
}

async function serverState(root, remote) {
  const key = `${root}|${remote}`;
  if ((apiOff.get(key) ?? 0) < Date.now()) {
    try {
      const heads = await gitlab.branchHeads(root, remote);
      if (heads) return { heads, tags: null, via: 'api' };
    } catch (error) {
      if (error.code === 'RATE_LIMIT' || error.code === 'NETWORK') throw error;
      apiOff.set(key, Date.now() + API_COOLDOWN); // токен не подходит — дальше через git
    }
  }
  const out = await git(root, ['ls-remote', '--heads', '--tags', remote], await quietEnv(root, LS_REMOTE_TIMEOUT));
  return { ...parseLsRemote(out), via: 'ls-remote' };
}

function diff(server, local) {
  const updated = [];
  const added = [];
  const removed = [];
  for (const [name, hash] of server.heads) {
    const mine = local.heads.get(name);
    if (!mine) added.push(name);
    else if (mine !== hash) updated.push(name);
  }
  for (const name of local.heads.keys()) if (!server.heads.has(name)) removed.push(name);
  // Только новые теги: изменённый на сервере тег Git без --force не заберёт, а свои локальные теги — не «удалённые»
  const tags = server.tags ? [...server.tags.keys()].filter((t) => !local.tags.has(t)) : [];
  return { updated, added, removed, tags };
}

const isEmpty = (d) => !d.updated.length && !d.added.length && !d.removed.length && !d.tags.length;

async function checkRemote(root, remote) {
  const server = await serverState(root, remote);
  const local = await localState(root, remote);
  const d = diff(server, local);
  const key = `${root}|${remote}`;
  if (isEmpty(d)) {
    lastSig.delete(key);
    return { remote, via: server.via, changes: d, fetched: false };
  }
  // То же расхождение, что после прошлого fetch (например, тег переписали на сервере) — не долбим сервер по кругу
  const sig = JSON.stringify(d);
  if (lastSig.get(key) === sig) return { remote, via: server.via, changes: d, fetched: false, stale: true };

  const args = ['fetch', '--prune', ...(d.tags.length ? ['--tags'] : []), remote];
  try {
    await git(root, args, await quietEnv(root, FETCH_TIMEOUT));
  } catch (error) {
    // Ветки уже скачаны, ругается только на изменённый тег — это не ошибка связи
    if (!/would clobber existing tag|\[rejected\].*\(would clobber/i.test(error.details ?? '')) throw error;
  }
  const after = diff(server, await localState(root, remote));
  if (isEmpty(after)) lastSig.delete(key);
  else lastSig.set(key, JSON.stringify(after));
  return { remote, via: server.via, changes: d, fetched: true };
}

/**
 * Один тик фоновой проверки.
 * → { status: 'ok'|'skipped'|'error', fetched, via, changes, reason?, error?, retryAfter?, ms }
 * Ошибки не бросаются: фон не должен показывать окна — решение о паузе (backoff) принимает интерфейс.
 */
async function lightCheck(root) {
  const started = Date.now();
  if (isBusy(root)) return { status: 'skipped', reason: 'busy', ms: 0 };
  try {
    const dir = await gitDir(root);
    // Внешний git (терминал, IDE) сейчас что-то делает — не мешаем
    if (fs.existsSync(path.join(dir, 'index.lock'))) return { status: 'skipped', reason: 'locked', ms: 0 };
  } catch {
    return { status: 'skipped', reason: 'no-repo', ms: 0 };
  }
  const job = runBackground(root, async () => {
    const remotes = await remotesToCheck(root);
    const results = [];
    for (const remote of remotes) results.push(await checkRemote(root, remote));
    return results;
  });
  if (!job) return { status: 'skipped', reason: 'busy', ms: 0 };
  try {
    const results = await job;
    const changes = { updated: [], added: [], removed: [], tags: [] };
    for (const r of results) for (const k of Object.keys(changes)) changes[k].push(...r.changes[k].map((n) => (k === 'tags' ? n : `${r.remote}/${n}`)));
    return {
      status: 'ok',
      fetched: results.some((r) => r.fetched),
      via: [...new Set(results.map((r) => r.via))].join('+') || null,
      remotes: results.map((r) => r.remote),
      changes,
      ms: Date.now() - started,
    };
  } catch (error) {
    return {
      status: 'error',
      error: { code: error.code ?? 'UNKNOWN', message: error.message },
      retryAfter: error.retryAfter ?? null,
      ms: Date.now() - started,
    };
  }
}

module.exports = { lightCheck, parseLsRemote, diff };
