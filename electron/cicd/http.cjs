// HTTP для API провайдеров CI/CD (GitHub, Gitea/Forgejo, Bitbucket): JSON, текст логов, файлы артефактов, ошибки по-русски.
const fs = require('node:fs');
const { GitError } = require('../errors.cjs');
const { t: tr } = require('../i18n.cjs');

let electron = null;
try {
  const mod = require('electron');
  if (mod && typeof mod === 'object') electron = mod;
} catch {
  electron = null;
}

const TIMEOUT = 20000;
const MAX_LOG = 1.5 * 1024 * 1024;

const doFetch = (...a) => (electron?.net?.fetch ? electron.net.fetch(...a) : fetch(...a));

/**
 * ctx: { apiBase, headers, label } — label: «GitHub», «Gitea», «Bitbucket» (для сообщений).
 * opts: { query, body, form, text, raw, notFound, accept, timeout }
 */
async function request(ctx, method, apiPath, opts = {}) {
  const { query, body, text = false, raw = false, notFound, accept, timeout = TIMEOUT } = opts;
  const url = new URL(/^https?:\/\//.test(apiPath) ? apiPath : `${ctx.apiBase}${apiPath}`);
  for (const [k, v] of Object.entries(query ?? {})) if (v != null && v !== '') url.searchParams.set(k, String(v));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  // Авторизацию отправляем только своему серверу (ссылки на логи и артефакты уводят на хранилище с подписанным адресом)
  const sameHost = url.host === new URL(ctx.apiBase).host;
  let res;
  try {
    res = await doFetch(url.toString(), {
      method,
      headers: {
        ...(sameHost ? ctx.headers : {}),
        Accept: accept ?? (text ? 'text/plain, */*' : 'application/json'),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        'User-Agent': 'git-Gorynych',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      redirect: 'follow',
    });
  } catch (error) {
    clearTimeout(timer);
    throw new GitError(error.name === 'AbortError' ? tr('{0} не ответил за {1} с', ctx.label, timeout / 1000) : tr('Нет связи с {0}', url.host), {
      code: 'NETWORK',
      hint: tr('Проверьте интернет, VPN и адрес API {0}', ctx.label),
      details: error.message,
    });
  }
  clearTimeout(timer);

  if (!res.ok) {
    let message = '';
    try {
      const data = await res.json();
      message = data.message ?? data.error?.message ?? data.error ?? data.errors?.[0]?.message ?? '';
      if (typeof message !== 'string') message = JSON.stringify(message);
    } catch {
      /* не JSON */
    }
    if (res.status === 401) {
      throw new GitError(tr('{0} не принял авторизацию репозитория', ctx.label), {
        code: 'AUTH',
        hint: tr('Токен неверный, отозван или истёк — обновите авторизацию репозитория'),
        details: message,
      });
    }
    if (res.status === 403) {
      const limited = res.headers.get('x-ratelimit-remaining') === '0';
      throw new GitError(limited ? tr('{0} ограничил частоту запросов — попробуйте позже', ctx.label) : tr('Недостаточно прав'), {
        code: limited ? 'RATE_LIMIT' : 'FORBIDDEN',
        hint: limited ? null : ctx.scopeHint ?? tr('У токена нет нужного права или ваша роль в репозитории не позволяет это действие'),
        details: message,
      });
    }
    if (res.status === 404) {
      throw new GitError(notFound ?? tr('Не найдено в {0}', ctx.label), {
        code: 'NOT_FOUND',
        hint: notFound ? null : tr('Репозиторий не существует, у токена нет к нему доступа или {0} не поддерживает этот запрос', ctx.label),
        details: message,
      });
    }
    if (res.status === 400 || res.status === 409 || res.status === 422) {
      throw new GitError(message ? `${ctx.label}: ${message}` : tr('{0} отклонил запрос', ctx.label), { code: 'VALIDATION', details: message });
    }
    if (res.status === 429) throw new GitError(tr('{0} ограничил частоту запросов — попробуйте через минуту', ctx.label), { code: 'RATE_LIMIT' });
    throw new GitError(tr('{0} вернул ошибку {1}', ctx.label, res.status), { code: 'API_ERROR', details: message });
  }
  if (raw) return res;
  if (text) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { text: buf.subarray(Math.max(0, buf.length - MAX_LOG)).toString('utf8'), size: buf.length };
  }
  if (res.status === 204 || res.status === 202) {
    const t = await res.text().catch(() => '');
    try {
      return t ? JSON.parse(t) : null;
    } catch {
      return null;
    }
  }
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

/** Скачать файл (артефакт) на диск потоком */
async function download(ctx, apiPath, dest, opts = {}) {
  const res = await request(ctx, 'GET', apiPath, { ...opts, raw: true, accept: '*/*', timeout: 10 * 60 * 1000 });
  const out = fs.createWriteStream(dest);
  let size = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  return { path: dest, size };
}

module.exports = { request, download, MAX_LOG };
