import { t } from '../i18n/index.ts';
// Шаблоны шагов для редактора CI: вставляются в позицию курсора с отступом текущей строки.
// Для GitHub/Gitea — шаги (steps), для GitLab — ключи задания или целое задание, для Bitbucket — шаги.

export interface CiSnippet {
  id: 'checkout' | 'cache' | 'docker' | 'ssh';
  label: string;
  text: string;
}

const GH: readonly CiSnippet[] = [
  { id: 'checkout', label: t('repository-checkout'), text: '- uses: actions/checkout@v4\n  with:\n    fetch-depth: 0' },
  {
    id: 'cache',
    label: t('dependency-caching'),
    text: "- uses: actions/cache@v4\n  with:\n    path: ~/.npm\n    key: ${{ runner.os }}-npm-${{ hashFiles('**/package-lock.json') }}\n    restore-keys: |\n      ${{ runner.os }}-npm-",
  },
  {
    id: 'docker',
    label: t('docker-image-build'),
    text: '- uses: docker/setup-buildx-action@v3\n- uses: docker/build-push-action@v6\n  with:\n    context: .\n    push: false\n    tags: app:${{ github.sha }}',
  },
  {
    id: 'ssh',
    label: t('ssh-deploy'),
    text: t('name-ssh-deploy-uses-appleboy'),
  },
];

const GL: readonly CiSnippet[] = [
  { id: 'checkout', label: t('checkout-clone-depth-and-strategy'), text: 'variables:\n  GIT_DEPTH: "20"\n  GIT_STRATEGY: fetch' },
  { id: 'cache', label: t('dependency-caching'), text: 'cache:\n  key:\n    files: [package-lock.json]\n  paths:\n    - .npm/' },
  {
    id: 'docker',
    label: t('job-docker-image-build'),
    text: 'build-image:\n  stage: build\n  image: docker:27\n  services: [docker:27-dind]\n  variables:\n    DOCKER_TLS_CERTDIR: "/certs"\n  script:\n    - docker login -u "$CI_REGISTRY_USER" -p "$CI_REGISTRY_PASSWORD" "$CI_REGISTRY"\n    - docker build -t "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA" .\n    - docker push "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA"',
  },
  {
    id: 'ssh',
    label: t('job-ssh-deploy'),
    text: 'deploy:\n  stage: deploy\n  image: alpine:3.20\n  before_script:\n    - apk add --no-cache openssh-client\n    - eval $(ssh-agent -s)\n    - echo "$SSH_PRIVATE_KEY" | tr -d \'\\r\' | ssh-add -\n    - mkdir -p ~/.ssh && echo "$SSH_KNOWN_HOSTS" > ~/.ssh/known_hosts\n  script:\n    - ssh "$DEPLOY_USER@$DEPLOY_HOST" "cd /srv/app && git pull && ./restart.sh"\n  environment: production\n  when: manual',
  },
];

const BB: readonly CiSnippet[] = [
  { id: 'checkout', label: t('checkout-clone-depth'), text: 'clone:\n  depth: 20' },
  { id: 'cache', label: t('dependency-caching'), text: 'caches:\n  - node' },
  { id: 'docker', label: t('step-docker-image-build'), text: t('step-name-image-build-services') },
  {
    id: 'ssh',
    label: t('step-ssh-deploy'),
    text: t('step-name-deploy-deployment-production'),
  },
];

/** `system` — `id` из `detect_ci` (`gitlab`, `github`, …); для прочих систем шаблонов нет. */
export function snippetsFor(system: unknown): readonly CiSnippet[] {
  if (system === 'gitlab') return GL;
  if (system === 'bitbucket') return BB;
  if (system === 'github' || system === 'gitea' || system === 'forgejo') return GH;
  return [];
}

/** Ключи, после которых редактор подсказывает метки раннеров */
export const TAG_KEYS: Readonly<Record<string, readonly string[]>> = { gitlab: ['tags'], github: ['runs-on'], gitea: ['runs-on'], forgejo: ['runs-on'], bitbucket: ['runs-on'] };
