// Git-серверы: облачные (github.com, gitlab.com) и свои (Self-Managed) — тип, подписи, ссылки на страницы токенов и SSH-ключей.
// Тип для домена определяет main-процесс (credentials.cjs): выбранный пользователем, догадка по имени или по API сервера.

export const SERVER_KINDS = [
  { id: 'gitlab', label: 'GitLab', self: 'GitLab Self-Managed', color: '#fc6d26' },
  { id: 'github', label: 'GitHub', self: 'GitHub Enterprise Server', color: '#8b949e' },
  { id: 'gitea', label: 'Gitea / Forgejo', self: 'Gitea / Forgejo', color: '#609926' },
  { id: 'bitbucket', label: 'Bitbucket', self: 'Bitbucket Data Center', color: '#2684ff' },
  { id: 'other', label: 'Другой Git-сервер', self: 'Другой Git-сервер', color: '#8a92a2' },
];

/** Облачные сервисы, которые выбираются одной кнопкой */
export const CLOUD_SERVERS = [
  { id: 'github.com', kind: 'github', label: 'GitHub', host: 'github.com' },
  { id: 'gitlab.com', kind: 'gitlab', label: 'GitLab', host: 'gitlab.com' },
];

export const kindInfo = (kind) => SERVER_KINDS.find((k) => k.id === kind) ?? null;

/** Название для человека: «GitLab» для gitlab.com, «GitLab Self-Managed» для своего сервера */
export function kindLabel(kind, cloud = false) {
  const k = kindInfo(kind);
  if (!k) return 'Git-сервер';
  return cloud ? k.label : k.self;
}

const trimBase = (base) => String(base ?? '').replace(/\/+$/, '');

/** Страница создания токена доступа */
export function tokenPage(kind, base, hostname) {
  const b = trimBase(base);
  if (!b) return null;
  if (kind === 'github') return `${hostname === 'github.com' ? 'https://github.com' : b}/settings/tokens`;
  // GitLab: сразу с правом api — один токен и для Pull/Push, и для пайплайнов
  if (kind === 'gitlab') return `${b}/-/user_settings/personal_access_tokens?name=${encodeURIComponent('git-Горыныч')}&scopes=api`;
  if (kind === 'gitea') return `${b}/user/settings/applications`;
  if (kind === 'bitbucket') return hostname === 'bitbucket.org' ? 'https://bitbucket.org/account/settings/app-passwords/' : `${b}/plugins/servlet/access-tokens/manage`;
  return null;
}

/** Страница SSH-ключей профиля */
export function sshKeysPage(kind, base, hostname) {
  const b = trimBase(base);
  if (!b) return null;
  if (kind === 'github') return `${hostname === 'github.com' ? 'https://github.com' : b}/settings/keys`;
  if (kind === 'gitlab') return `${b}/-/user_settings/ssh_keys`;
  if (kind === 'gitea') return `${b}/user/settings/keys`;
  if (kind === 'bitbucket') return hostname === 'bitbucket.org' ? 'https://bitbucket.org/account/settings/ssh-keys/' : `${b}/plugins/servlet/ssh/account/keys`;
  return null;
}

/** Какие права нужны токену для clone / pull / push (для GitLab — и для пайплайнов CI/CD) */
export function tokenScopes(kind) {
  if (kind === 'github') return ['repo'];
  if (kind === 'gitlab') return ['api'];
  if (kind === 'gitea') return ['write:repository'];
  if (kind === 'bitbucket') return ['Repository: write'];
  return null;
}

export function tokenPlaceholder(kind) {
  if (kind === 'github') return 'ghp_… или github_pat_…';
  if (kind === 'gitlab') return 'glpat-…';
  return 'токен доступа';
}

/** Сервер не принимает обычный пароль для Git (2FA / политика) — подсказать вкладку «Токен» */
export const prefersToken = (kind) => kind === 'github' || kind === 'gitlab' || kind === 'bitbucket';
