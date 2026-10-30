// Клонирование репозитория с прогрессом и отменой.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { GitError, fromProcessError } = require('./errors.cjs');
const { gitInfo } = require('./git.cjs');

const running = new Map(); // id -> { child, target, created }

function repoNameFromUrl(url) {
  const clean = String(url).trim().replace(/[\\/]+$/, '').replace(/\.git$/i, '');
  const name = clean.split(/[\\/:]/).filter(Boolean).pop() || 'repository';
  return name.replace(/[<>:"|?*]/g, '_');
}

async function probeClone(url) {
  const init = require('./init.cjs');
  const remoteUrl = init.validateUrl(url);
  const os = require('node:os');
  const heads = await init.remoteHeads(remoteUrl, os.tmpdir());
  return {
    url: remoteUrl,
    host: /gitlab/i.test(remoteUrl) ? 'GitLab' : /github/i.test(remoteUrl) ? 'GitHub' : /bitbucket/i.test(remoteUrl) ? 'Bitbucket' : null,
    name: repoNameFromUrl(remoteUrl),
    ...heads,
  };
}

function checkTarget(parent, name) {
  if (typeof parent !== 'string' || !parent) throw new GitError('Выберите папку для клонирования', { code: 'BAD_ARGS' });
  if (typeof name !== 'string' || !name.trim() || /[<>:"|?*\\/]/.test(name)) {
    throw new GitError('Недопустимое имя папки', { code: 'BAD_ARGS' });
  }
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new GitError(`Папка не найдена: ${parent}`, { code: 'NOT_FOUND_PATH' });
  }
  const target = path.join(parent, name.trim());
  if (fs.existsSync(target)) {
    const empty = fs.statSync(target).isDirectory() && fs.readdirSync(target).length === 0;
    if (!empty) {
      throw new GitError(`Папка «${name}» уже существует и не пуста`, {
        code: 'TARGET_EXISTS',
        hint: 'Выберите другое имя или другую папку.',
      });
    }
    return { target, created: false };
  }
  return { target, created: true };
}

// Фазы прогресса git clone → русские подписи и вес в общей шкале
const PHASES = [
  { re: /Counting objects/i, label: 'Подсчёт объектов', from: 0, to: 5 },
  { re: /Compressing objects/i, label: 'Сжатие на сервере', from: 5, to: 10 },
  { re: /Receiving objects/i, label: 'Загрузка', from: 10, to: 80 },
  { re: /Resolving deltas/i, label: 'Обработка', from: 80, to: 92 },
  { re: /Updating files|Checking out files/i, label: 'Распаковка файлов', from: 92, to: 100 },
];

function parseProgress(line) {
  const pct = /(\d+)%/.exec(line);
  const phase = PHASES.find((p) => p.re.test(line));
  if (!phase) return null;
  const local = pct ? Number(pct[1]) : 0;
  const speed = /\|\s*([\d.,]+\s*[KMG]?i?B\/s)/.exec(line)?.[1] ?? null;
  const size = /,\s*([\d.,]+\s*[KMG]?i?B)\s*\|/.exec(line)?.[1] ?? null;
  return {
    phase: phase.label,
    percent: Math.round(phase.from + ((phase.to - phase.from) * local) / 100),
    phasePercent: local,
    speed,
    size,
  };
}

/**
 * Клонирует url в parent/name. onProgress({ phase, percent, speed, size }).
 * Возвращает { path, name, branch }.
 */
async function cloneRepository({ id, url, parent, name, branch, depth }, onProgress) {
  const init = require('./init.cjs');
  const { networkOptions } = require('./actions.cjs');
  const remoteUrl = init.validateUrl(url);
  const { target, created } = checkTarget(parent, name || repoNameFromUrl(remoteUrl));
  const opts = await networkOptions(parent, { url: remoteUrl });

  const args = ['-c', 'core.quotepath=false', 'clone', '--progress'];
  if (branch) args.push('--branch', branch);
  if (depth) args.push('--depth', String(Number(depth)));
  args.push(remoteUrl, target);

  return new Promise((resolve, reject) => {
    const child = spawn(gitInfo().binary, args, {
      cwd: parent,
      windowsHide: true,
      env: { ...process.env, ...opts.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    running.set(id, { child, target, created, cancelled: false });
    let stderr = '';
    let buffer = '';
    let last = 0;

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 200000) stderr = stderr.slice(-100000);
      buffer += chunk;
      const parts = buffer.split(/[\r\n]/);
      buffer = parts.pop();
      for (const line of parts) {
        const p = parseProgress(line);
        const now = Date.now();
        if (p && (now - last > 120 || p.phasePercent === 100)) {
          last = now;
          onProgress?.(p);
        }
      }
    });

    child.on('error', (error) => {
      running.delete(id);
      reject(fromProcessError(error, '', stderr));
    });

    child.on('close', (code) => {
      const job = running.get(id);
      running.delete(id);
      const cleanup = () => {
        try {
          if (job?.created) fs.rmSync(target, { recursive: true, force: true });
          else if (fs.existsSync(target)) for (const e of fs.readdirSync(target)) fs.rmSync(path.join(target, e), { recursive: true, force: true });
        } catch {
          /* не смогли убрать частично скачанное — не критично */
        }
      };
      if (job?.cancelled) {
        cleanup();
        reject(new GitError('Клонирование отменено', { code: 'CANCELLED' }));
        return;
      }
      if (code !== 0) {
        cleanup();
        const err = fromProcessError({ code, message: stderr }, '', stderr);
        if (['AUTH', 'FORBIDDEN', 'NOT_FOUND'].includes(err.code)) err.hint = init.hostHint(remoteUrl) ?? err.hint;
        reject(err);
        return;
      }
      onProgress?.({ phase: 'Готово', percent: 100, phasePercent: 100 });
      resolve({ path: target, name: path.basename(target) });
    });
  });
}

function cancelClone(id) {
  const job = running.get(id);
  if (!job) return false;
  job.cancelled = true;
  job.child.kill();
  return true;
}

module.exports = { probeClone, cloneRepository, cancelClone, repoNameFromUrl };
