// Проверка команд в скриптах CI против самого репозитория и образа задания:
// нет файла / нет права на запуск / нет npm-скрипта / нет lock-файла / нет цели make / docker без демона /
// apt-get в alpine / npm в образе без Node / секреты в открытом виде.
const { q, SECRET_VALUE } = require('./ciCheckBase.cjs');
const { t: tr } = require('./i18n.cjs');

/* ---------- Образы: что в них есть ---------- */

// Инструменты, которые есть в официальных образах (без доустановки)
const IMAGE_TOOLS = [
  [/^(?:.*\/)?node(?::|$)/, ['node', 'npm', 'npx', 'yarn', 'corepack']],
  [/^(?:.*\/)?python(?::|$)/, ['python', 'python3', 'pip', 'pip3']],
  [/^(?:.*\/)?(?:golang|go)(?::|$)/, ['go']],
  [/^(?:.*\/)?ruby(?::|$)/, ['ruby', 'gem', 'bundle', 'bundler']],
  [/^(?:.*\/)?php(?::|$)/, ['php']],
  [/^(?:.*\/)?composer(?::|$)/, ['php', 'composer']],
  [/^(?:.*\/)?maven(?::|$)/, ['mvn', 'java']],
  [/^(?:.*\/)?gradle(?::|$)/, ['gradle', 'java']],
  [/^(?:.*\/)?(?:openjdk|eclipse-temurin|amazoncorretto)(?::|$)/, ['java']],
  [/^(?:.*\/)?rust(?::|$)/, ['cargo', 'rustc']],
  [/^(?:.*\/)?docker(?::|$)/, ['docker']],
  [/(?:^|\/)dotnet\/sdk(?::|$)/, ['dotnet']],
  [/^(?:.*\/)?(?:alpine|busybox|ubuntu|debian|centos|fedora|rockylinux|almalinux)(?::|$)/, []],
];
const TOOL_FAMILY = {
  node: 'Node.js', npm: 'Node.js', npx: 'Node.js', yarn: 'Node.js', pnpm: 'pnpm',
  python: 'Python', python3: 'Python', pip: 'Python', pip3: 'Python',
  go: 'Go', ruby: 'Ruby', gem: 'Ruby', bundle: 'Ruby', php: 'PHP', composer: 'Composer',
  mvn: 'Maven', gradle: 'Gradle', java: 'Java', cargo: 'Rust', rustc: 'Rust', docker: 'Docker CLI', dotnet: '.NET SDK',
};
const INSTALLS = /\b(?:apt-get|apt|apk|yum|dnf|microdnf|zypper)\s+(?:-\S+\s+)*(?:install|add)\b|\bcurl\b[^|]*\|\s*(?:ba|z)?sh\b|\bwget\b[^|]*\|\s*(?:ba|z)?sh\b|\bnvm\s+install\b|\bcorepack\s+enable\b|\bnpm\s+(?:i|install)\s+(?:-g|--global)\b|\bsdk\s+install\b|\bpyenv\s+install\b|\buv\s+(?:python|tool)\s+install\b|\bsetup-\w+\b/;

function imageInfo(image) {
  if (!image || /\$/.test(image)) return null;
  const name = String(image).toLowerCase().replace(/^docker\.io\//, '').replace(/^library\//, '');
  const alpine = /alpine|busybox/.test(name);
  const known = IMAGE_TOOLS.find(([re]) => re.test(name));
  if (!known) return { name, alpine, known: false, tools: new Set() };
  const debianLike = !alpine && !/centos|fedora|rocky|alma|amazoncorretto/.test(name);
  return { name, alpine, debianLike, known: true, tools: new Set(known[1]) };
}

/* ---------- Разбор строки скрипта ---------- */

// Команды одной строки: «a && b; c | d» → [['a'], ['b'], …] (кавычки уважаются)
function splitCommands(line) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    const two = line.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      out.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (c === ';' || c === '|') {
      out.push(cur);
      cur = '';
      continue;
    }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) break; // комментарий
    cur += c;
  }
  out.push(cur);
  return out.map((c) => words(c.trim())).filter((w) => w.length);
}
function words(cmd) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(cmd))) out.push(m[1] ?? m[2] ?? m[3]);
  // VAR=value cmd … и sudo/exec/time — к самой команде
  while (out.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(out[0]) || ['sudo', 'exec', 'time', 'command', 'env', 'nohup'].includes(out[0]))) out.shift();
  return out;
}

const literal = (p) => p && !/[$`*?{}~]/.test(p) && !/^[a-z]+:\/\//i.test(p);
const join = (cwd, p) => {
  const parts = `${cwd ? `${cwd}/` : ''}${p}`.split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
};
// Папки, которые обычно появляются во время сборки — их отсутствие в репозитории нормально
const BUILD_OUTPUT = /^(dist|build|out|target|public|coverage|node_modules|\.venv|venv|vendor|bin|obj|\.next|\.nuxt|tmp|\.cache|reports?|artifacts?|release)(\/|$)/;

const YARN_BUILTIN = new Set('install add remove upgrade up init info global audit cache config create dlx exec link pack publish run set unlink why workspace workspaces version bin help login logout outdated licenses list import check autoclean policies team tag owner versions node npm constraints dedupe explain patch plugin rebuild search stage unplug'.split(' '));

/**
 * jobs: [{ name, file, line, lines: [{ text, line }], image, services: [], vars: Set, artifactsFrom: [путей] , system }]
 * add(issue) — добавить проблему.
 */
function checkScripts(jobs, repo, add, { system = 'gitlab' } = {}) {
  const pkgCache = new Map();
  const pkgScripts = (dir) => {
    const key = join(dir, 'package.json');
    if (!pkgCache.has(key)) {
      const text = repo.read(key);
      let scripts = null;
      try {
        scripts = text ? JSON.parse(text).scripts ?? {} : null;
      } catch {
        scripts = {};
      }
      pkgCache.set(key, scripts);
    }
    return pkgCache.get(key);
  };
  const makeTargets = (dir) => {
    for (const f of ['GNUmakefile', 'makefile', 'Makefile']) {
      const text = repo.read(join(dir, f));
      if (text != null) {
        const targets = new Set();
        for (const m of text.matchAll(/^([A-Za-z0-9_.\-/%]+)\s*:(?!=)/gm)) targets.add(m[1]);
        return { file: join(dir, f), targets, dynamic: /^include\s|\$\(|%:/m.test(text) };
      }
    }
    return null;
  };
  const shellName = system === 'github' ? 'bash' : 'sh';
  // Одна и та же причина (нет package.json в папке, нет Makefile) — сообщаем один раз
  const once = new Set();
  const first = (key) => (once.has(key) ? false : (once.add(key), true));

  for (const job of jobs) {
    const where = job.where ?? tr('задание {0}', q(job.name));
    let cwd = job.cwd ?? '';
    const created = new Set(); // пути, созданные раньше в этом же задании
    const exists = (p, kind = 'file') => {
      const full = join(cwd, p);
      if ([...created].some((c) => full === c || full.startsWith(`${c}/`))) return true;
      if ((job.artifactsFrom ?? []).some((a) => full === a || full.startsWith(`${a.replace(/\/+$/, '')}/`) || a === '.' || a === '')) return true;
      if (BUILD_OUTPUT.test(full)) return true;
      return kind === 'dir' ? repo.hasDir(full) : repo.hasFile(full);
    };
    const img = imageInfo(job.image);
    let installed = false;
    let dockerWarned = false;
    const missingTool = new Set();
    const lineAdd = (ln, o) => add({ file: ln.file ?? job.file, line: ln.line ?? job.line, job: job.name, when: tr('При выполнении {0} {1}', job.kind ?? tr('задания'), q(job.name)), ...o });

    for (const ln of job.lines) {
      if (ln.reset) cwd = ln.cwd ?? job.cwd ?? ''; // новый шаг — новый shell
      const text = String(ln.text ?? '');
      // Секреты прямо в скрипте
      for (const [re, what] of SECRET_VALUE) {
        if (re.test(text)) {
          lineAdd(ln, {
            id: 'secret-in-script',
            severity: 'error',
            title: tr('В скрипте {0} открытым текстом {1}', where, tr(what)),
            how: tr('Значение попадёт в историю Git и в логи заданий — его увидит любой, у кого есть доступ к репозиторию или к логам.'),
            why: tr('Секреты в файле CI не скрываются: маскируются только переменные из настроек проекта.'),
            fix: tr('Отзовите этот ключ/токен и создайте новый; храните его в защищённой переменной (Settings → CI/CD → Variables, masked) и используйте как $ИМЯ.'),
          });
          break;
        }
      }
      if (INSTALLS.test(text)) installed = true;

      for (const w of splitCommands(text)) {
        const [cmd, ...args] = w;
        if (!cmd) continue;
        const pos = args.filter((a) => !a.startsWith('-'));

        // cd: папка должна быть
        if (cmd === 'cd') {
          const dir = pos[0];
          if (dir && literal(dir) && dir !== '-' && !dir.startsWith('/')) {
            if (!exists(dir, 'dir')) {
              lineAdd(ln, {
                id: 'cd-missing',
                severity: 'error',
                title: tr('cd {0}: такой папки в репозитории нет', dir),
                how: tr('Задание упадёт на этой строке: «{0}: cd: {1}: No such file or directory».', shellName, dir),
                why: tr('Папки {0} нет среди файлов репозитория, и раньше в задании её никто не создаёт.', q(join(cwd, dir))),
                fix: tr('Проверьте путь (регистр букв важен на Linux) или создайте папку раньше (mkdir -p) / получите её артефактом из предыдущего задания.'),
              });
            }
            cwd = join(cwd, dir);
          } else if (dir && dir.startsWith('/')) cwd = '\u0000'; // абсолютный путь — дальше проверять файлы не можем
          continue;
        }
        if (cwd === '\u0000') continue;

        // Что создаётся по ходу — не ругаться на это дальше
        if (cmd === 'mkdir' || cmd === 'touch') pos.forEach((p) => literal(p) && created.add(join(cwd, p)));
        if (cmd === 'git' && args[0] === 'clone') pos.slice(2).forEach((p) => literal(p) && created.add(join(cwd, p)));
        if (cmd === 'git' && args[0] === 'clone' && pos.length === 2) created.add(join(cwd, pos[1].split('/').pop().replace(/\.git$/, '')));
        if ((cmd === 'curl' || cmd === 'wget') && args.some((a, i) => ['-o', '-O', '--output', '--output-document'].includes(args[i - 1]))) {
          args.forEach((a, i) => ['-o', '-O', '--output', '--output-document'].includes(args[i - 1]) && literal(a) && created.add(join(cwd, a)));
        }
        if (['cp', 'mv', 'ln', 'unzip', 'tar', 'npx', 'cookiecutter'].includes(cmd) && pos.length) created.add(join(cwd, pos.at(-1)));
        if (cmd === 'echo' || cmd === 'cat' || cmd === 'printf') {
          const m = /(?:^|\s)>{1,2}\s*(\S+)/.exec(text);
          if (m && literal(m[1])) created.add(join(cwd, m[1]));
        }

        // Пакетный менеджер не того дистрибутива
        if (img?.known && img.alpine && ['apt-get', 'apt', 'yum', 'dnf'].includes(cmd)) {
          lineAdd(ln, {
            id: 'pkg-alpine',
            severity: 'error',
            title: tr('{0} в образе {1}', cmd, img.name),
            how: tr('Задание упадёт: «{0}: {1}: not found».', shellName, cmd),
            why: tr('{0} — образ на Alpine Linux, там пакетный менеджер apk, а {1} нет.', q(img.name), cmd),
            fix: tr('Используйте apk add --no-cache … или образ на Debian/Ubuntu (без «-alpine» в теге).'),
          });
        }
        if (img?.known && img.debianLike && cmd === 'apk') {
          lineAdd(ln, {
            id: 'pkg-debian',
            severity: 'error',
            title: tr('apk в образе {0}', img.name),
            how: tr('Задание упадёт: «{0}: apk: not found».', shellName),
            why: tr('{0} основан на Debian/Ubuntu — там apt-get, а apk есть только в Alpine.', q(img.name)),
            fix: tr('Замените на apt-get update && apt-get install -y … или возьмите вариант образа с «-alpine».'),
          });
        }
        if (img?.known && img.alpine && cmd === 'bash' && !installed) {
          lineAdd(ln, {
            id: 'bash-alpine',
            severity: 'warning',
            title: tr('bash в образе {0}', img.name),
            how: tr('«sh: bash: not found» — в Alpine по умолчанию только sh (ash).'),
            why: tr('Образы Alpine минимальные: bash в них не установлен.'),
            fix: tr('Запускайте через sh или добавьте apk add --no-cache bash перед этим.'),
          });
        }

        // Инструмент, которого нет в образе
        const tool = cmd === 'python3' ? 'python3' : cmd;
        if (img?.known && TOOL_FAMILY[tool] && !img.tools.has(tool) && !installed && !missingTool.has(TOOL_FAMILY[tool]) && !(tool === 'docker' && job.system === 'bitbucket')) {
          const pnpmInNode = tool === 'pnpm' && img.tools.has('node');
          missingTool.add(TOOL_FAMILY[tool]);
          lineAdd(ln, {
            id: 'tool-missing',
            severity: 'warning',
            title: tr('{0}: в образе {1} нет {2}', cmd, img.name, TOOL_FAMILY[tool]),
            how: tr('Скорее всего задание упадёт: «{0}: {1}: not found» (код 127).', shellName, cmd),
            why: pnpmInNode
              ? tr('В образах node есть npm и yarn, а pnpm нужно включить отдельно.')
              : tr('Официальный образ {0} не содержит {1}, и раньше в задании он не устанавливается.', q(img.name), TOOL_FAMILY[tool]),
            fix: pnpmInNode ? tr('Добавьте перед этим corepack enable (или npm i -g pnpm).') : tr('Возьмите образ с {0} или установите его раньше в скрипте.', TOOL_FAMILY[tool]),
          });
        }

        // docker без демона
        if (cmd === 'docker' && ['build', 'push', 'run', 'pull', 'login', 'compose', 'buildx', 'tag', 'exec', 'ps', 'images'].includes(args[0]) && job.system === 'gitlab' && !dockerWarned) {
          const dind = (job.services ?? []).some((s) => /docker.*dind/i.test(s));
          const host = job.vars?.has('DOCKER_HOST');
          if (!dind && !host) {
            dockerWarned = true;
            lineAdd(ln, {
              id: 'docker-no-daemon',
              severity: 'warning',
              title: tr('docker {0} без Docker-демона', args[0]),
              how: tr('На раннере с Docker executor задание упадёт: «Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?»'),
              why: tr('В контейнере задания есть только клиент docker (если он вообще есть), а сам демон не запущен: нет services: docker:dind и не задан DOCKER_HOST.'),
              fix: tr('Добавьте services: [docker:dind] и variables: DOCKER_TLS_CERTDIR: "/certs" (образ docker:…), либо используйте раннер с shell executor / сокетом docker, либо kaniko/buildah.'),
            });
          }
        }

        // Запуск файла: ./script.sh, scripts/x, sh x, python x.py…
        const runsFile = (cmd.startsWith('./') || (cmd.includes('/') && !cmd.startsWith('/') && !cmd.startsWith('$'))) && literal(cmd);
        if (runsFile) {
          const p = join(cwd, cmd);
          if (!exists(cmd)) {
            lineAdd(ln, {
              id: 'exec-missing',
              severity: 'error',
              title: tr('{0}: файла нет в репозитории', cmd),
              how: tr('Задание упадёт: «{0}: {1}: not found» (или No such file or directory).', shellName, cmd),
              why: tr('Файла {0} нет среди файлов репозитория и его не создаёт ни это задание, ни артефакты предыдущих.', q(p)),
              fix: tr('Проверьте путь и регистр букв; если файл генерируется — передайте его артефактом (artifacts + needs/dependencies).'),
            });
          } else if (repo.mode(p) === '100644') {
            lineAdd(ln, {
              id: 'exec-not-executable',
              severity: 'error',
              title: tr('{0}: у файла нет права на запуск', cmd),
              how: tr('Задание упадёт: «{0}: {1}: Permission denied» (код 126).', shellName, cmd),
              why: tr('В Git файл {0} сохранён без флага исполняемости (режим 100644) — так бывает, если его добавили в Windows.', q(p)),
              fix: tr('Выполните git update-index --chmod=+x {0} и закоммитьте; или запускайте через интерпретатор: sh {1}.', p, cmd),
            });
          }
        }
        if (['sh', 'bash', 'source', '.', 'python', 'python3', 'node', 'ruby', 'php', 'perl', 'pwsh', 'powershell'].includes(cmd)) {
          const file = pos[0];
          if (file && literal(file) && /\.[A-Za-z0-9]+$/.test(file) && !(cmd === 'python' && args[0] === '-m') && !(cmd === 'python3' && args[0] === '-m') && !exists(file)) {
            lineAdd(ln, {
              id: 'script-missing',
              severity: 'error',
              title: tr('{0} {1}: файла нет в репозитории', cmd, file),
              how: cmd === 'node' ? tr('Задание упадёт: «Error: Cannot find module \'…/{0}\'».', file) : cmd.startsWith('python') ? tr('Задание упадёт: «can\'t open file \'{0}\': [Errno 2] No such file or directory».', file) : tr('Задание упадёт: «{0}: No such file or directory».', file),
              why: tr('Файла {0} нет в репозитории (с учётом предыдущих cd).', q(join(cwd, file))),
              fix: tr('Проверьте путь и регистр букв или передайте файл артефактом из задания, которое его создаёт.'),
            });
          }
        }

        // npm / yarn / pnpm
        const isNpm = cmd === 'npm';
        if ((isNpm || cmd === 'yarn' || cmd === 'pnpm') && !exists('package.json')) {
          if (first(`pkg|${cwd}`)) lineAdd(ln, {
            id: 'pkg-json-missing',
            severity: 'error',
            title: tr('{0}: нет package.json в {1}', cmd, cwd || tr('корне')),
            how: isNpm ? '«npm ERR! enoent Could not read package.json: ENOENT: no such file or directory».' : tr('{0} завершится ошибкой: не найден package.json.', cmd),
            why: tr('Команда выполняется в папке {0}, а package.json там нет.', q(cwd || '.')),
            fix: tr('Перейдите в папку проекта (cd …) или поправьте путь.'),
          });
          continue;
        }
        if (isNpm && (args[0] === 'ci' || args[0] === 'clean-install') && !exists('package-lock.json') && !exists('npm-shrinkwrap.json')) {
          lineAdd(ln, {
            id: 'npm-ci-no-lock',
            severity: 'error',
            title: tr('npm ci без package-lock.json'),
            how: '«npm ERR! The `npm ci` command can only install with an existing package-lock.json or npm-shrinkwrap.json».',
            why: tr('В {0} нет package-lock.json — его не закоммитили (или он в .gitignore).', q(cwd || tr('корне'))),
            fix: tr('Закоммитьте package-lock.json (npm install локально создаст его) или замените npm ci на npm install.'),
          });
        }
        const runName = isNpm
          ? args[0] === 'run' || args[0] === 'run-script'
            ? pos[1]
            : ['test', 't', 'start', 'stop', 'restart'].includes(args[0])
              ? { t: 'test' }[args[0]] ?? args[0]
              : null
          : cmd === 'yarn'
            ? args[0] === 'run'
              ? pos[1]
              : args[0] && !args[0].startsWith('-') && !YARN_BUILTIN.has(args[0])
                ? args[0]
                : null
            : cmd === 'pnpm'
              ? args[0] === 'run'
                ? pos[1]
                : args[0] === 'test'
                  ? 'test'
                  : null
              : null;
        if (runName && literal(runName)) {
          const scripts = pkgScripts(cwd);
          if (scripts && !(runName in scripts) && !(runName === 'start' && repo.hasFile(join(cwd, 'server.js')))) {
            lineAdd(ln, {
              id: 'npm-script-missing',
              severity: 'error',
              title: tr('{0} {1}{2}: такого скрипта нет в package.json', cmd, args[0] === 'run' ? 'run ' : '', runName),
              how: isNpm ? `«npm ERR! Missing script: "${runName}"».` : `«error Command "${runName}" not found.»`,
              why: tr('В {0} в разделе scripts есть: {1}.', join(cwd, 'package.json'), Object.keys(scripts).join(', ') || tr('ничего')),
              fix: tr('Добавьте "{0}" в scripts или поправьте имя.{1}', runName, Object.keys(scripts).length ? tr(' Похожие: {0}.', Object.keys(scripts).slice(0, 5).join(', ')) : ''),
            });
          }
        }
        if (cmd === 'yarn' && (args.includes('--frozen-lockfile') || args.includes('--immutable')) && !exists('yarn.lock')) {
          lineAdd(ln, {
            id: 'yarn-no-lock',
            severity: 'error',
            title: tr('yarn с --frozen-lockfile без yarn.lock'),
            how: '«error Your lockfile needs to be updated, but yarn was run with `--frozen-lockfile`».',
            why: tr('В {0} нет yarn.lock.', q(cwd || tr('корне'))),
            fix: tr('Закоммитьте yarn.lock или уберите флаг.'),
          });
        }
        if (cmd === 'pnpm' && (args[0] === 'install' || args[0] === 'i') && !args.includes('--no-frozen-lockfile') && !exists('pnpm-lock.yaml')) {
          lineAdd(ln, {
            id: 'pnpm-no-lock',
            severity: 'error',
            title: tr('pnpm install без pnpm-lock.yaml'),
            how: tr('В CI pnpm по умолчанию работает с --frozen-lockfile: «ERR_PNPM_NO_LOCKFILE Cannot install with "frozen-lockfile" because pnpm-lock.yaml is absent».'),
            why: tr('В {0} нет pnpm-lock.yaml.', q(cwd || tr('корне'))),
            fix: tr('Закоммитьте pnpm-lock.yaml или добавьте --no-frozen-lockfile.'),
          });
        }

        // pip / poetry
        if ((cmd === 'pip' || cmd === 'pip3' || (cmd.startsWith('python') && args[0] === '-m' && args[1] === 'pip')) && args.includes('-r')) {
          const f = args[args.indexOf('-r') + 1];
          if (f && literal(f) && !exists(f)) {
            lineAdd(ln, {
              id: 'pip-req-missing',
              severity: 'error',
              title: tr('pip install -r {0}: файла нет', f),
              how: `«ERROR: Could not open requirements file: [Errno 2] No such file or directory: '${f}'».`,
              why: tr('Файла {0} нет в репозитории.', q(join(cwd, f))),
              fix: tr('Проверьте имя (requirements.txt / requirements-dev.txt) и папку.'),
            });
          }
        }
        if (cmd === 'poetry' && args[0] === 'install' && !exists('pyproject.toml')) {
          lineAdd(ln, { id: 'poetry-no-project', severity: 'error', title: tr('poetry install без pyproject.toml'), how: '«Poetry could not find a pyproject.toml file in … or its parents».', why: tr('В {0} нет pyproject.toml.', q(cwd || tr('корне'))), fix: tr('Перейдите в папку проекта или добавьте pyproject.toml.') });
        }

        // make
        if (cmd === 'make' && !args.includes('-f') && !args.includes('-C')) {
          const mk = makeTargets(cwd);
          if (!mk) {
            if (first(`make|${cwd}`)) lineAdd(ln, { id: 'make-no-makefile', severity: 'error', title: tr('make: нет Makefile в {0}', cwd || tr('корне')), how: '«make: *** No targets specified and no makefile found.  Stop.»', why: tr('В {0} нет Makefile.', q(cwd || '.')), fix: tr('Добавьте Makefile или перейдите в нужную папку (make -C папка …).') });
          } else if (!mk.dynamic) {
            for (const t of pos.filter((a) => literal(a) && !a.includes('='))) {
              if (!mk.targets.has(t)) {
                lineAdd(ln, {
                  id: 'make-no-target',
                  severity: 'error',
                  title: tr('make {0}: такой цели нет в {1}', t, mk.file),
                  how: `«make: *** No rule to make target '${t}'.  Stop.»`,
                  why: tr('В {0} есть цели: {1}.', mk.file, [...mk.targets].slice(0, 12).join(', ') || tr('нет')),
                  fix: tr('Поправьте имя цели или добавьте её в Makefile.'),
                });
              }
            }
          }
        }

        // Сборщики и их файлы проекта
        const need = (files, title, how) => {
          if (!files.some((f) => (f.includes('*') ? repo.glob(join(cwd, f)) : exists(f))) && first(`build|${files[0]}|${cwd}`)) {
            lineAdd(ln, { id: 'build-file-missing', severity: 'error', title, how, why: tr('В {0} нет {1}.', q(cwd || tr('корне')), files.join(' / ')), fix: tr('Перейдите в папку проекта (cd …) или проверьте путь.') });
          }
        };
        if (cmd === 'mvn') need(['pom.xml'], tr('mvn: нет pom.xml'), '«[ERROR] The goal you specified requires a project to execute but there is no POM in this directory».');
        if (cmd === 'gradle') need(['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'], tr('gradle: нет build.gradle'), tr('Gradle не найдёт сборку: «Directory … does not contain a Gradle build».'));
        if (cmd === 'go' && ['build', 'test', 'vet', 'run', 'mod'].includes(args[0])) need(['go.mod'], tr('go: нет go.mod'), '«go: go.mod file not found in current directory or any parent directory».');
        if (cmd === 'cargo' && ['build', 'test', 'run', 'check', 'clippy'].includes(args[0])) need(['Cargo.toml'], tr('cargo: нет Cargo.toml'), '«error: could not find `Cargo.toml` in … or any parent directory».');
        if (cmd === 'composer' && ['install', 'update'].includes(args[0])) need(['composer.json'], tr('composer: нет composer.json'), '«Composer could not find a composer.json file».');
        if (cmd === 'bundle' && ['install', 'exec'].includes(args[0])) need(['Gemfile'], tr('bundle: нет Gemfile'), '«Could not locate Gemfile».');
        if (cmd === 'dotnet' && ['build', 'test', 'restore', 'publish'].includes(args[0]) && !pos[1]) need(['*.sln', '*.csproj', '*.fsproj'], tr('dotnet: нет проекта (.sln / .csproj)'), '«MSBUILD : error MSB1003: Specify a project or solution file».');

        // docker build / compose / kubectl -f
        if (cmd === 'docker' && (args[0] === 'build' || (args[0] === 'buildx' && args[1] === 'build'))) {
          const fi = args.findIndex((a) => a === '-f' || a === '--file');
          const ctx = pos.at(-1);
          const dockerfile = fi >= 0 ? args[fi + 1] : ctx && literal(ctx) ? join(ctx, 'Dockerfile') : null;
          if (dockerfile && literal(dockerfile) && !exists(dockerfile)) {
            lineAdd(ln, {
              id: 'dockerfile-missing',
              severity: 'error',
              title: tr('docker build: нет {0}', dockerfile),
              how: '«failed to solve: failed to read dockerfile: open Dockerfile: no such file or directory».',
              why: tr('Файла {0} нет в репозитории.', q(join(cwd, dockerfile))),
              fix: tr('Укажите правильный путь через -f или поправьте контекст сборки.'),
            });
          }
        }
        if ((cmd === 'docker-compose' || (cmd === 'docker' && args[0] === 'compose')) && (args.includes('-f') || args.includes('--file'))) {
          const f = args[args.findIndex((a) => a === '-f' || a === '--file') + 1];
          if (f && literal(f) && !exists(f)) lineAdd(ln, { id: 'compose-missing', severity: 'error', title: tr('docker compose -f {0}: файла нет', f), how: '«open …: no such file or directory».', why: tr('Файла {0} нет в репозитории.', q(join(cwd, f))), fix: tr('Проверьте путь.') });
        }
        if (cmd === 'kubectl' && ['apply', 'create', 'delete', 'replace'].includes(args[0]) && args.includes('-f')) {
          const f = args[args.indexOf('-f') + 1];
          if (f && literal(f) && /\.(ya?ml|json)$/.test(f) && !exists(f)) lineAdd(ln, { id: 'kubectl-missing', severity: 'error', title: tr('kubectl {0} -f {1}: файла нет', args[0], f), how: `«error: the path "${f}" does not exist».`, why: tr('Файла {0} нет в репозитории.', q(join(cwd, f))), fix: tr('Проверьте путь.') });
        }
      }
    }
  }
}

module.exports = { checkScripts, imageInfo, splitCommands };
