// Открыть папку репозитория в системном файловом менеджере или терминале.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { GitError } = require('./errors.cjs');

function requireDir(dir) {
  if (typeof dir !== 'string' || !dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new GitError('Папка не найдена', { code: 'NOT_FOUND', hint: String(dir ?? '') });
  }
  return path.resolve(dir);
}

/**
 * Запуск отдельной программы, не привязанной к нашему процессу.
 * → Promise<true>, если программа запустилась; reject — если её нет (ENOENT) или она не стартовала.
 */
function launch(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false, ...options });
    } catch (error) {
      reject(error);
      return;
    }
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve(true);
    });
  });
}

/** Перебирает варианты, пока один не запустится. → название запущенного */
async function firstThatStarts(candidates) {
  let lastError = null;
  for (const c of candidates) {
    try {
      await launch(c.cmd, c.args, c.options);
      return c.name;
    } catch (error) {
      lastError = error;
    }
  }
  throw new GitError('Не удалось открыть терминал', {
    code: 'NO_TERMINAL',
    hint: 'Не найден ни один из известных терминалов. Откройте папку вручную.',
    details: lastError?.message ?? '',
  });
}

/** Варианты терминала для платформы — в порядке предпочтения */
function terminalCandidates(dir, platform = process.platform, exists = fs.existsSync) {
  if (platform === 'darwin') {
    const iterm = ['/Applications/iTerm.app', path.join(process.env.HOME ?? '', 'Applications/iTerm.app')].some((p) => exists(p));
    return [
      ...(iterm ? [{ name: 'iTerm', cmd: 'open', args: ['-a', 'iTerm', dir] }] : []),
      { name: 'Terminal', cmd: 'open', args: ['-a', 'Terminal', dir] },
    ];
  }
  if (platform === 'win32') {
    // Отдельный процесс с detached получает собственное окно консоли
    return [
      { name: 'Windows Terminal', cmd: 'wt.exe', args: ['-d', dir] },
      { name: 'PowerShell', cmd: 'powershell.exe', args: ['-NoExit', '-NoLogo'], options: { cwd: dir } },
      // cwd уже нужная папка — лишние кавычки в аргументах cmd.exe разбирает плохо
      { name: 'Командная строка', cmd: 'cmd.exe', args: ['/K'], options: { cwd: dir } },
    ];
  }
  return [
    { name: 'x-terminal-emulator', cmd: 'x-terminal-emulator', args: [], options: { cwd: dir } },
    { name: 'GNOME Terminal', cmd: 'gnome-terminal', args: [`--working-directory=${dir}`], options: { cwd: dir } },
    { name: 'Konsole', cmd: 'konsole', args: ['--workdir', dir], options: { cwd: dir } },
    { name: 'Xfce Terminal', cmd: 'xfce4-terminal', args: [`--working-directory=${dir}`], options: { cwd: dir } },
    { name: 'kitty', cmd: 'kitty', args: ['--directory', dir], options: { cwd: dir } },
    { name: 'Alacritty', cmd: 'alacritty', args: ['--working-directory', dir], options: { cwd: dir } },
    { name: 'xterm', cmd: 'xterm', args: [], options: { cwd: dir } },
  ];
}

async function openTerminal(dir) {
  const target = requireDir(dir);
  const name = await firstThatStarts(terminalCandidates(target));
  return { terminal: name };
}

async function openFolder(shell, dir) {
  const target = requireDir(dir);
  const error = await shell.openPath(target); // пустая строка — успех
  if (error) throw new GitError('Не удалось открыть папку', { code: 'OPEN_FAILED', details: error });
  return { path: target };
}

module.exports = { openTerminal, openFolder, terminalCandidates, launch };
