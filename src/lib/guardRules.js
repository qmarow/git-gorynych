// Pre-commit Guard: правила по умолчанию и чтение/запись настроек.
// files — расширения через запятую (пусто = все файлы). Порядок важен: на строку показывается первое сработавшее правило,
// поэтому секреты идут первыми.

export const DEFAULT_RULES = [
  // Секреты
  { id: 'private-key', category: 'secret', label: 'Приватный ключ', pattern: '-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----' },
  { id: 'aws-key-id', category: 'secret', label: 'AWS Access Key ID', pattern: '\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b' },
  { id: 'aws-secret', category: 'secret', label: 'Ключ AWS (AWS_…)', pattern: 'AWS_(?:SECRET_ACCESS_KEY|ACCESS_KEY_ID|SESSION_TOKEN)\\s*[:=]\\s*["\']?[A-Za-z0-9/+=]{16,}' },
  { id: 'openai-key', category: 'secret', label: 'API-ключ sk-…', pattern: '\\bsk-(?:proj-|live-|test-|ant-)?[A-Za-z0-9_-]{20,}' },
  { id: 'github-token', category: 'secret', label: 'Токен GitHub', pattern: '\\bgh[pousr]_[A-Za-z0-9]{30,}\\b' },
  { id: 'gitlab-token', category: 'secret', label: 'Токен GitLab', pattern: '\\bglpat-[A-Za-z0-9_-]{20,}' },
  { id: 'slack-token', category: 'secret', label: 'Токен Slack', pattern: '\\bxox[abpors]-[A-Za-z0-9-]{10,}' },
  { id: 'google-key', category: 'secret', label: 'Ключ Google API', pattern: '\\bAIza[0-9A-Za-z_-]{35}\\b' },
  { id: 'bearer', category: 'secret', label: 'Bearer-токен', pattern: '\\bBearer\\s+[A-Za-z0-9._~+/-]{20,}=*' },
  { id: 'jwt', category: 'secret', label: 'JWT', pattern: '\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}' },
  { id: 'password-assign', category: 'secret', label: 'Пароль или ключ в коде', flags: 'i', pattern: '(?:password|passwd|secret|api[_-]?key|access[_-]?token)\\s*[:=]\\s*["\'][^"\'\\s]{8,}["\']' },
  // Забытая отладка
  { id: 'conflict-marker', category: 'debug', label: 'Маркер конфликта', pattern: '^(?:<{7}|>{7}|={7})(?: |$)' },
  { id: 'console-log', category: 'debug', label: 'console.log', files: 'js,jsx,ts,tsx,mjs,cjs,vue,svelte', pattern: '\\bconsole\\.(?:log|debug|trace|dir|table)\\s*\\(' },
  { id: 'debugger', category: 'debug', label: 'debugger', files: 'js,jsx,ts,tsx,mjs,cjs,vue,svelte', pattern: '^\\s*debugger\\s*;?\\s*(?://.*)?$' },
  { id: 'print', category: 'debug', label: 'print()', files: 'py', pattern: '^\\s*print\\s*\\(' },
  { id: 'pdb', category: 'debug', label: 'breakpoint() / pdb', files: 'py', pattern: '\\b(?:breakpoint\\s*\\(\\)|pdb\\.set_trace\\s*\\(|import\\s+i?pdb)' },
  { id: 'php-dump', category: 'debug', label: 'var_dump / dd()', files: 'php', pattern: '\\b(?:var_dump|print_r|dd|dump)\\s*\\(' },
  { id: 'test-only', category: 'debug', label: '.only в тестах', files: 'js,jsx,ts,tsx,mjs,cjs', pattern: '\\b(?:it|describe|test)\\.only\\s*\\(' },
  { id: 'todo-remove', category: 'debug', label: 'TODO: remove', flags: 'i', pattern: '\\b(?:TODO|FIXME|XXX|HACK)\\b.*\\b(?:remove|delete|убрать|удалить|temp|временн)' }, // gorynych-ignore
  { id: 'do-not-commit', category: 'debug', label: 'DO NOT COMMIT', flags: 'i', pattern: '\\b(?:DO\\s*NOT\\s*COMMIT|NOCOMMIT|НЕ\\s*КОММИТИТЬ)\\b' }, // gorynych-ignore
];

export const CATEGORY_LABELS = { secret: 'Похоже на секрет', debug: 'Забытая отладка', other: 'Свои правила' };

// Что делать при срабатывании правила
export const LEVELS = [
  { id: 'off', label: 'Выкл', hint: 'Правило не проверяется' },
  { id: 'warn', label: 'Предупреждать', hint: 'Показать и спросить, коммитить ли всё равно' },
  { id: 'block', label: 'Запрещать', hint: 'Коммит не создаётся, пока строка не исправлена или не помечена gorynych-ignore' },
];

// Частые исключения — подсказки в настройках
export const EXCLUDE_SUGGESTIONS = ['**/*.min.js', '**/vendor/**', '**/dist/**', '**/*.test.*', '**/__tests__/**', 'docs/**', '*.md', 'package-lock.json'];

const KEY = 'guard.v1';

export const DEFAULT_GUARD = {
  enabled: true, // проверять перед коммитом
  live: true, // подсказки, пока готовите коммит (плашка, значки, отметки в diff)
  levels: {}, // id правила → off | warn | block (по умолчанию warn)
  exclude: [], // пути, которые не проверяются (glob)
  custom: [],
  repoOff: [], // репозитории, где проверка выключена
};

export function readGuard() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!v) return DEFAULT_GUARD;
    const levels = v.levels && typeof v.levels === 'object' ? { ...v.levels } : {};
    // Старый формат: список выключенных правил
    if (Array.isArray(v.disabled)) for (const id of v.disabled) levels[id] = levels[id] ?? 'off';
    return {
      enabled: v.enabled !== false,
      live: v.live !== false,
      levels,
      exclude: Array.isArray(v.exclude) ? v.exclude.filter((x) => typeof x === 'string' && x.trim()) : [],
      custom: Array.isArray(v.custom) ? v.custom.filter((r) => r && r.pattern) : [],
      repoOff: Array.isArray(v.repoOff) ? v.repoOff : [],
    };
  } catch {
    return DEFAULT_GUARD;
  }
}

export function writeGuard(cfg) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* хранилище недоступно — настройки действуют до перезапуска */
  }
}

export const levelOf = (cfg, rule) => cfg.levels?.[rule.id] ?? rule.level ?? 'warn';

export function guardOnFor(cfg, repoPath) {
  return Boolean(cfg.enabled) && !(repoPath && cfg.repoOff?.includes(repoPath));
}

// Правила, которые реально отправляются на проверку (с уровнем)
export function activeRules(cfg) {
  const custom = cfg.custom.map((r) => ({ ...r, category: r.category ?? 'other' }));
  const withLevel = (r) => ({ ...r, level: levelOf(cfg, r) });
  // Свои правила-секреты — вперёд, остальные свои — в конец
  return [
    ...custom.filter((r) => r.category === 'secret'),
    ...DEFAULT_RULES,
    ...custom.filter((r) => r.category !== 'secret'),
  ]
    .map(withLevel)
    .filter((r) => r.level !== 'off');
}

export function validatePattern(pattern, flags = '') {
  try {
    new RegExp(pattern, flags); // eslint-disable-line no-new
    return null;
  } catch (error) {
    return error.message;
  }
}
