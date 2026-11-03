const { t } = require('./i18n.cjs');
// Ошибки Git с понятной классификацией: авторизация, доступ, защищённые ветки, сеть и т.д.

class GitError extends Error {
  // data — структурированные подробности для интерфейса (например, список файлов при WIP_CONFLICT)
  constructor(message, { code = 'GIT', hint = null, details = '', stdout = '', data = null } = {}) {
    super(message);
    this.name = 'GitError';
    this.code = code;
    this.hint = hint;
    this.details = details;
    this.stdout = stdout;
    this.data = data;
  }

  toJSON() {
    return { code: this.code, message: this.message, hint: this.hint, details: this.details, ...(this.data ? { data: this.data } : {}) };
  }
}

// Порядок важен: более конкретные шаблоны идут раньше общих
const RULES = [
  {
    code: 'PROTECTED',
    re: /protected branch|GH006|GH013|not allowed to (push|force push) (code )?to protected|cannot force-push to a protected|push declined due to repository rule|branch is protected/i,
    get message() {
    return t('Ветка защищена на сервере — прямой push запрещён');
  },
    get hint() {
    return t('Создайте отдельную ветку и откройте Pull Request, либо попросите администратора изменить правила защиты.');
  },
  },
  {
    code: 'HOOK_DECLINED',
    re: /pre-receive hook declined|hook declined/i,
    get message() {
    return t('Сервер отклонил push (серверный хук)');
  },
    get hint() {
    return t('Посмотрите подробности: сервер обычно сообщает причину в строках, начинающихся с «remote:».');
  },
  },
  {
    code: 'FORBIDDEN',
    re: /The requested URL returned error: 403|Permission to \S+ denied|You don't have permission|write access to repository not granted|not allowed to push|insufficient permission|HTTP 403|access forbidden|You are not allowed to push/i,
    get message() {
    return t('Нет прав на запись в этот репозиторий');
  },
    get hint() {
    return t('Ваш аккаунт или токен имеет только права на чтение. Попросите доступ Write у владельца репозитория или используйте токен со scope «repo».');
  },
  },
  {
    code: 'HOST_KEY',
    re: /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i,
    get message() {
    return t('SSH: ключ сервера не подтверждён');
  },
    get hint() {
    return t('Один раз подключитесь из терминала (например, «ssh -T git@github.com») и подтвердите отпечаток сервера.');
  },
  },
  {
    code: 'AUTH',
    re: /Authentication failed|could not read (Username|Password)|terminal prompts disabled|Invalid username or password|HTTP Basic: Access denied|Permission denied \(publickey|returned error: 401|Bad credentials|invalid credentials|logon failed|unable to get password|SSH_AUTH_SOCK|passphrase/i,
    get message() {
    return t('Ошибка авторизации на сервере');
  },
    get hint() {
    return t('Введите логин и пароль, токен доступа или выберите SSH-ключ в окне «Авторизация репозитория» — программа запомнит их для этого репозитория. ') +
      t('Для HTTPS также подойдёт окно Git Credential Manager; для SSH — ключ, добавленный в аккаунт на сервере.');
  },
  },
  {
    code: 'NOT_FOUND',
    re: /Repository not found|does not appear to be a git repository|repository '.*' not found|returned error: 404|project you were looking for could not be found|No such remote/i,
    get message() {
    return t('Репозиторий не найден или к нему нет доступа');
  },
    get hint() {
    return t('Проверьте URL remote. Для приватных репозиториев сервер отвечает «not found», если у аккаунта нет доступа.');
  },
  },
  {
    code: 'REJECTED_NON_FF',
    re: /\[rejected\].*(non-fast-forward|fetch first)|Updates were rejected because|stale info|\[rejected\]/i,
    get message() {
    return t('Remote-ветка содержит коммиты, которых нет у вас');
  },
    get hint() {
    return t('Сначала сделайте Pull, либо Force Push (with lease), если уверены, что хотите перезаписать remote.');
  },
  },
  {
    code: 'DIVERGED',
    re: /Not possible to fast-forward|diverging branches|Need to specify how to reconcile/i,
    get message() {
    return t('Ветки разошлись — fast-forward невозможен');
  },
    get hint() {
    return t('Используйте Pull (fast-forward if possible) или Pull (rebase).');
  },
  },
  {
    code: 'CONFLICT',
    re: /CONFLICT|Automatic merge failed|could not apply|Merge conflict|fix conflicts/i,
    get message() {
    return t('Возникли конфликты слияния');
  },
    get hint() {
    return t('Разрешите конфликты в отмеченных файлах, затем застейджите их и сделайте коммит.');
  },
  },
  {
    code: 'DIRTY',
    re: /would be overwritten|Please commit your changes or stash them|cannot (pull|rebase) with uncommitted|You have unstaged changes|contains uncommitted changes/i,
    get message() {
    return t('Локальные изменения мешают операции');
  },
    get hint() {
    return t('Закоммитьте изменения или сделайте Stash, затем повторите.');
  },
  },
  {
    code: 'NETWORK',
    re: /Could not resolve host|Failed to connect|Connection (timed out|refused|reset)|Network is unreachable|unable to access|Operation timed out|SSL|TLS|early EOF|The remote end hung up|Could not read from remote repository/i,
    get message() {
    return t('Не удалось связаться с сервером');
  },
    get hint() {
    return t('Проверьте подключение к интернету, VPN или прокси.');
  },
  },
];

function classify(stderr = '', stdout = '') {
  const text = `${stderr}\n${stdout}`;
  for (const rule of RULES) {
    if (rule.re.test(text)) return rule;
  }
  return null;
}

function fromProcessError(error, stdout = '', stderr = '') {
  if (error.code === 'ENOENT') {
    return new GitError(t('Git не найден'), {
      code: 'GIT_MISSING',
      hint:
        t('Установите Git for Windows (git-scm.com). Если Git уже установлен — полностью закройте терминал/VS Code, ') +
        t('из которого запускали приложение, и откройте заново: старые окна не видят обновлённый PATH.'),
    });
  }
  const details = (stderr || error.message || '').trim();
  if (error.killed) {
    return new GitError(t('Операция прервана по таймауту'), {
      code: 'TIMEOUT',
      hint: t('Сервер не ответил вовремя, либо Git ждал ввода логина. Попробуйте ещё раз.'),
      details,
      stdout,
    });
  }
  const rule = classify(stderr, stdout);
  if (rule) return new GitError(rule.message, { code: rule.code, hint: rule.hint, details, stdout });

  const firstLine = details.split('\n').find((l) => l.trim()) ?? t('Ошибка Git');
  return new GitError(firstLine.replace(/^(fatal|error):\s*/i, ''), { code: 'GIT', details, stdout });
}

function serializeError(error) {
  if (error instanceof GitError) return error.toJSON();
  return { code: 'UNKNOWN', message: error?.message || String(error), hint: null, details: '' };
}

module.exports = { GitError, classify, fromProcessError, serializeError };
