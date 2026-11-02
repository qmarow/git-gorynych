// Подключение раннера: готовые команды (Docker, Linux/macOS, Windows) и локальный Docker-раннер в один клик.
const { execFile } = require('node:child_process');
const { GitError } = require('../errors.cjs');

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'repo';

/** Внутри контейнера localhost — сам контейнер: адрес своего компьютера там — host.docker.internal */
const forContainer = (url) => String(url).replace(/^(https?:\/\/)(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/i, '$1host.docker.internal');

/**
 * Команды для копирования. provider: gitlab | github | gitea; reg: { url, token, kind }; labels; name.
 * → [{ id, label, shell, text }]
 */
function commands(provider, { url, token, labels = [], name = 'git-gorynych-runner' }) {
  const L = labels.join(',');
  if (provider === 'gitlab') {
    const reg = (bin) => `${bin} register --non-interactive --url ${url} --token ${token} --executor`;
    return [
      {
        id: 'docker',
        label: 'Docker',
        shell: 'bash',
        text: [
          `docker run -d --name ${name} --restart always \\`,
          `  -v /var/run/docker.sock:/var/run/docker.sock \\`,
          `  -v ${name}-config:/etc/gitlab-runner \\`,
          `  gitlab/gitlab-runner:latest`,
          `docker exec ${name} gitlab-runner register --non-interactive \\`,
          `  --url ${forContainer(url)} --token ${token} \\`,
          `  --executor docker --docker-image alpine:latest --name ${name}`,
        ].join('\n'),
      },
      {
        id: 'linux',
        label: 'Linux',
        shell: 'bash',
        text: [
          'sudo curl -L --output /usr/local/bin/gitlab-runner https://s3.dualstack.us-east-1.amazonaws.com/gitlab-runner-downloads/latest/binaries/gitlab-runner-linux-amd64',
          'sudo chmod +x /usr/local/bin/gitlab-runner',
          'sudo useradd --comment "GitLab Runner" --create-home gitlab-runner --shell /bin/bash || true',
          'sudo gitlab-runner install --user=gitlab-runner --working-directory=/home/gitlab-runner',
          `sudo ${reg('gitlab-runner')} shell --name ${name}`,
          'sudo gitlab-runner start',
        ].join('\n'),
      },
      {
        id: 'macos',
        label: 'macOS',
        shell: 'bash',
        text: [
          'sudo curl -L --output /usr/local/bin/gitlab-runner https://s3.dualstack.us-east-1.amazonaws.com/gitlab-runner-downloads/latest/binaries/gitlab-runner-darwin-arm64',
          'sudo chmod +x /usr/local/bin/gitlab-runner',
          `${reg('gitlab-runner')} shell --name ${name}`,
          'gitlab-runner install && gitlab-runner start',
        ].join('\n'),
      },
      {
        id: 'windows',
        label: 'Windows',
        shell: 'powershell',
        text: [
          "New-Item -Path 'C:\\GitLab-Runner' -ItemType Directory -Force | Out-Null",
          "Invoke-WebRequest -Uri 'https://s3.dualstack.us-east-1.amazonaws.com/gitlab-runner-downloads/latest/binaries/gitlab-runner-windows-amd64.exe' -OutFile 'C:\\GitLab-Runner\\gitlab-runner.exe'",
          'cd C:\\GitLab-Runner',
          `.\\gitlab-runner.exe register --non-interactive --url ${url} --token ${token} --executor shell --shell pwsh --name ${name}`,
          '.\\gitlab-runner.exe install',
          '.\\gitlab-runner.exe start',
        ].join('\n'),
      },
    ];
  }
  if (provider === 'github') {
    const cfg = (bin) => `${bin} --url ${url} --token ${token} --name ${name}${L ? ` --labels ${L}` : ''} --unattended`;
    const latest = 'V=$(curl -s https://api.github.com/repos/actions/runner/releases/latest | sed -n \'s/.*"tag_name": *"v\\([^"]*\\)".*/\\1/p\')';
    return [
      {
        id: 'docker',
        label: 'Docker',
        shell: 'bash',
        text: [
          `docker run -d --name ${name} --restart always \\`,
          `  -e REPO_URL=${url} -e RUNNER_TOKEN=${token} \\`,
          `  -e RUNNER_NAME=${name} -e RUNNER_SCOPE=repo${L ? ` -e LABELS=${L}` : ''} \\`,
          `  -v /var/run/docker.sock:/var/run/docker.sock \\`,
          `  myoung34/github-runner:latest`,
        ].join('\n'),
      },
      {
        id: 'linux',
        label: 'Linux',
        shell: 'bash',
        text: [
          'mkdir -p actions-runner && cd actions-runner',
          latest,
          'curl -sL -o runner.tar.gz https://github.com/actions/runner/releases/download/v$V/actions-runner-linux-x64-$V.tar.gz',
          'tar xzf runner.tar.gz',
          cfg('./config.sh'),
          'sudo ./svc.sh install && sudo ./svc.sh start',
        ].join('\n'),
      },
      {
        id: 'macos',
        label: 'macOS',
        shell: 'bash',
        text: [
          'mkdir -p actions-runner && cd actions-runner',
          latest,
          'curl -sL -o runner.tar.gz https://github.com/actions/runner/releases/download/v$V/actions-runner-osx-arm64-$V.tar.gz',
          'tar xzf runner.tar.gz',
          cfg('./config.sh'),
          './svc.sh install && ./svc.sh start',
        ].join('\n'),
      },
      {
        id: 'windows',
        label: 'Windows',
        shell: 'powershell',
        text: [
          'New-Item -Path C:\\actions-runner -ItemType Directory -Force | Out-Null; cd C:\\actions-runner',
          "$v = (Invoke-RestMethod https://api.github.com/repos/actions/runner/releases/latest).tag_name.TrimStart('v')",
          'Invoke-WebRequest -Uri "https://github.com/actions/runner/releases/download/v$v/actions-runner-win-x64-$v.zip" -OutFile runner.zip',
          'Expand-Archive runner.zip -DestinationPath . -Force',
          `${cfg('.\\config.cmd')} --runasservice`,
        ].join('\n'),
      },
    ];
  }
  if (provider === 'gitea') {
    const reg = (bin) => `${bin} register --no-interactive --instance ${url} --token ${token} --name ${name}${L ? ` --labels ${L}` : ''}`;
    return [
      {
        id: 'docker',
        label: 'Docker',
        shell: 'bash',
        text: [
          `docker run -d --name ${name} --restart always \\`,
          `  -e GITEA_INSTANCE_URL=${forContainer(url)} \\`,
          `  -e GITEA_RUNNER_REGISTRATION_TOKEN=${token} \\`,
          `  -e GITEA_RUNNER_NAME=${name}${L ? ` -e GITEA_RUNNER_LABELS=${L}` : ''} \\`,
          `  -v /var/run/docker.sock:/var/run/docker.sock \\`,
          `  -v ${name}-data:/data \\`,
          `  gitea/act_runner:latest`,
        ].join('\n'),
      },
      {
        id: 'linux',
        label: 'Linux',
        shell: 'bash',
        text: [
          '# Свежая версия act_runner: https://gitea.com/gitea/act_runner/releases',
          'curl -L -o act_runner https://dl.gitea.com/act_runner/nightly/act_runner-nightly-linux-amd64 && chmod +x act_runner',
          reg('./act_runner'),
          'nohup ./act_runner daemon > act_runner.log 2>&1 &',
        ].join('\n'),
      },
      {
        id: 'macos',
        label: 'macOS',
        shell: 'bash',
        text: [
          'curl -L -o act_runner https://dl.gitea.com/act_runner/nightly/act_runner-nightly-darwin-arm64 && chmod +x act_runner',
          reg('./act_runner'),
          'nohup ./act_runner daemon > act_runner.log 2>&1 &',
        ].join('\n'),
      },
      {
        id: 'windows',
        label: 'Windows',
        shell: 'powershell',
        text: [
          "Invoke-WebRequest -Uri 'https://dl.gitea.com/act_runner/nightly/act_runner-nightly-windows-amd64.exe' -OutFile act_runner.exe",
          reg('.\\act_runner.exe'),
          '.\\act_runner.exe daemon',
        ].join('\n'),
      },
    ];
  }
  return [];
}

/* =================== Локальный Docker =================== */

let dockerBin = process.env.GK_DOCKER_BIN || 'docker';

function docker(args, { timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(dockerBin, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const text = String(stderr || error.message).trim();
        if (error.code === 'ENOENT') return reject(new GitError('Docker не установлен', { code: 'NO_DOCKER', hint: 'Установите Docker Desktop и запустите его' }));
        if (/Cannot connect to the Docker daemon|error during connect|daemon is not running|pipe\/docker_engine/i.test(text)) {
          return reject(new GitError('Docker не запущен', { code: 'NO_DOCKER', hint: 'Запустите Docker Desktop и попробуйте снова' }));
        }
        return reject(new GitError('Docker вернул ошибку', { code: 'DOCKER', details: text, hint: text.split('\n').pop()?.slice(0, 300) }));
      }
      resolve(String(stdout));
    });
  });
}

async function dockerStatus() {
  try {
    const v = (await docker(['version', '--format', '{{.Server.Version}}'], { timeout: 8000 })).trim();
    return { available: true, version: v || null };
  } catch (error) {
    return { available: false, reason: error.message, hint: error.hint ?? null };
  }
}

const LABEL = 'ru.gorynych.runner';

/** Локальные раннеры, поднятые приложением (по метке контейнера) */
async function localRunners(repoKey = null) {
  const out = await docker(['ps', '-a', '--filter', `label=${LABEL}=1`, '--format', '{{json .}}'], { timeout: 15000 });
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const c = JSON.parse(line);
      const labels = Object.fromEntries(String(c.Labels ?? '').split(',').filter(Boolean).map((kv) => [kv.split('=')[0], kv.split('=').slice(1).join('=')]));
      return {
        id: c.ID,
        name: c.Names,
        image: c.Image,
        state: c.State ?? (/^Up/.test(c.Status) ? 'running' : 'exited'),
        status: c.Status,
        provider: labels[`${LABEL}.provider`] ?? null,
        repo: labels[`${LABEL}.repo`] ?? null,
        runnerLabels: (labels[`${LABEL}.labels`] ?? '').split(';').filter(Boolean),
      };
    })
    .filter((c) => !repoKey || c.repo === repoKey);
}

/** Поднять раннер в контейнере: reg — { url, token } от провайдера */
async function startLocal(provider, { reg, labels = [], repoKey, repoName }) {
  const st = await dockerStatus();
  if (!st.available) throw new GitError(st.reason, { code: 'NO_DOCKER', hint: st.hint });
  const name = `gorynych-${provider}-${slug(repoName)}-${Date.now().toString(36).slice(-4)}`;
  const meta = ['--label', `${LABEL}=1`, '--label', `${LABEL}.provider=${provider}`, '--label', `${LABEL}.repo=${repoKey}`, '--label', `${LABEL}.labels=${labels.join(';')}`];
  const sock = ['-v', '/var/run/docker.sock:/var/run/docker.sock'];
  const url = forContainer(reg.url);
  if (provider === 'gitlab') {
    await docker(['run', '-d', '--name', name, '--restart', 'unless-stopped', ...meta, ...sock, '-v', `${name}-config:/etc/gitlab-runner`, 'gitlab/gitlab-runner:latest'], { timeout: 10 * 60 * 1000 });
    try {
      await docker(['exec', name, 'gitlab-runner', 'register', '--non-interactive', '--url', url, '--token', reg.token, '--executor', 'docker', '--docker-image', 'alpine:latest', '--docker-volumes', '/var/run/docker.sock:/var/run/docker.sock', '--name', name], { timeout: 120000 });
    } catch (error) {
      await docker(['rm', '-f', name]).catch(() => {});
      throw error;
    }
  } else if (provider === 'github') {
    const env = ['-e', `REPO_URL=${reg.url}`, '-e', `RUNNER_TOKEN=${reg.token}`, '-e', `RUNNER_NAME=${name}`, '-e', 'RUNNER_SCOPE=repo', ...(labels.length ? ['-e', `LABELS=${labels.join(',')}`] : [])];
    await docker(['run', '-d', '--name', name, '--restart', 'unless-stopped', ...meta, ...env, ...sock, 'myoung34/github-runner:latest'], { timeout: 10 * 60 * 1000 });
  } else if (provider === 'gitea') {
    const env = ['-e', `GITEA_INSTANCE_URL=${url}`, '-e', `GITEA_RUNNER_REGISTRATION_TOKEN=${reg.token}`, '-e', `GITEA_RUNNER_NAME=${name}`, ...(labels.length ? ['-e', `GITEA_RUNNER_LABELS=${labels.join(',')}`] : [])];
    await docker(['run', '-d', '--name', name, '--restart', 'unless-stopped', ...meta, ...env, ...sock, '-v', `${name}-data:/data`, 'gitea/act_runner:latest'], { timeout: 10 * 60 * 1000 });
  } else {
    throw new GitError('Локальный раннер для этого провайдера не поддерживается', { code: 'UNSUPPORTED' });
  }
  return { name };
}

async function stopLocal(name, { remove = true } = {}) {
  if (!/^gorynych-[a-z0-9-]+$/.test(String(name))) throw new GitError('Это не раннер приложения', { code: 'BAD_ARGS' });
  if (remove) {
    await docker(['rm', '-f', name]);
    await docker(['volume', 'rm', '-f', `${name}-config`, `${name}-data`]).catch(() => {});
  } else await docker(['stop', name]);
  return { name };
}

async function resumeLocal(name) {
  if (!/^gorynych-[a-z0-9-]+$/.test(String(name))) throw new GitError('Это не раннер приложения', { code: 'BAD_ARGS' });
  await docker(['start', name]);
  return { name };
}

module.exports = { commands, dockerStatus, localRunners, startLocal, stopLocal, resumeLocal, forContainer, shq, psq, _setDockerBin: (b) => (dockerBin = b) };
