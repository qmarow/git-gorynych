// Настройки CI/CD репозитория: какой провайдер (если не определился сам) и свой адрес API
// (GitLab Self-Managed, GitHub Enterprise, Gitea за прокси). Токен не хранится здесь — он берётся из авторизации репозитория.
const fs = require('node:fs');
const path = require('node:path');
const { GitError } = require('../errors.cjs');

let electron = null;
try {
  const mod = require('electron');
  if (mod && typeof mod === 'object') electron = mod;
} catch {
  electron = null;
}

const PROVIDERS = new Set(['gitlab', 'github', 'gitea', 'bitbucket']);

function file() {
  const dir = process.env.GK_TEST_USERDATA || electron?.app?.getPath('userData');
  if (!dir) return null;
  return path.join(dir, 'cicd-settings.json');
}

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return data && typeof data.repos === 'object' ? data : { repos: {} };
  } catch {
    return { repos: {} };
  }
}

/** Ключ репозитория: host + путь без учёта регистра */
const keyOf = (host, repoPath) => `${String(host ?? '').toLowerCase()}/${String(repoPath ?? '').toLowerCase().replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '')}`;

/** { provider, apiBase } или null */
function get(host, repoPath) {
  return read().repos[keyOf(host, repoPath)] ?? null;
}

function normalizeBase(input) {
  const raw = String(input ?? '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) throw new GitError('Адрес API должен начинаться с https://', { code: 'BAD_ARGS' });
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new GitError('Некорректный адрес API', { code: 'BAD_ARGS', hint: 'Например: https://gitlab.company.ru или https://github.company.ru/api/v3' });
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new GitError('Адрес API должен начинаться с https://', { code: 'BAD_ARGS' });
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

function set(host, repoPath, { provider = null, apiBase = null } = {}) {
  if (provider && !PROVIDERS.has(provider)) throw new GitError('Неизвестный провайдер CI/CD', { code: 'BAD_ARGS' });
  const f = file();
  if (!f) throw new GitError('Хранилище настроек недоступно', { code: 'NO_STORAGE' });
  const data = read();
  const key = keyOf(host, repoPath);
  const base = normalizeBase(apiBase);
  if (!provider && !base) delete data.repos[key];
  else data.repos[key] = { provider: provider || null, apiBase: base, savedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(data, null, 2));
  return data.repos[key] ?? null;
}

module.exports = { get, set, normalizeBase, PROVIDERS };
