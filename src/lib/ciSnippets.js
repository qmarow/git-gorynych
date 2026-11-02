// Шаблоны шагов для редактора CI: вставляются в позицию курсора с отступом текущей строки.
// Для GitHub/Gitea — шаги (steps), для GitLab — ключи задания или целое задание, для Bitbucket — шаги.

const GH = [
  { id: 'checkout', label: 'Checkout репозитория', text: '- uses: actions/checkout@v4\n  with:\n    fetch-depth: 0' },
  {
    id: 'cache',
    label: 'Кэширование зависимостей',
    text: "- uses: actions/cache@v4\n  with:\n    path: ~/.npm\n    key: ${{ runner.os }}-npm-${{ hashFiles('**/package-lock.json') }}\n    restore-keys: |\n      ${{ runner.os }}-npm-",
  },
  {
    id: 'docker',
    label: 'Сборка Docker-образа',
    text: '- uses: docker/setup-buildx-action@v3\n- uses: docker/build-push-action@v6\n  with:\n    context: .\n    push: false\n    tags: app:${{ github.sha }}',
  },
  {
    id: 'ssh',
    label: 'Деплой по SSH',
    text: '- name: Деплой по SSH\n  uses: appleboy/ssh-action@v1\n  with:\n    host: ${{ secrets.DEPLOY_HOST }}\n    username: ${{ secrets.DEPLOY_USER }}\n    key: ${{ secrets.DEPLOY_KEY }}\n    script: |\n      cd /srv/app\n      git pull\n      ./restart.sh',
  },
];

const GL = [
  { id: 'checkout', label: 'Checkout: глубина и стратегия клона', text: 'variables:\n  GIT_DEPTH: "20"\n  GIT_STRATEGY: fetch' },
  { id: 'cache', label: 'Кэширование зависимостей', text: 'cache:\n  key:\n    files: [package-lock.json]\n  paths:\n    - .npm/' },
  {
    id: 'docker',
    label: 'Задание: сборка Docker-образа',
    text: 'build-image:\n  stage: build\n  image: docker:27\n  services: [docker:27-dind]\n  variables:\n    DOCKER_TLS_CERTDIR: "/certs"\n  script:\n    - docker login -u "$CI_REGISTRY_USER" -p "$CI_REGISTRY_PASSWORD" "$CI_REGISTRY"\n    - docker build -t "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA" .\n    - docker push "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA"',
  },
  {
    id: 'ssh',
    label: 'Задание: деплой по SSH',
    text: 'deploy:\n  stage: deploy\n  image: alpine:3.20\n  before_script:\n    - apk add --no-cache openssh-client\n    - eval $(ssh-agent -s)\n    - echo "$SSH_PRIVATE_KEY" | tr -d \'\\r\' | ssh-add -\n    - mkdir -p ~/.ssh && echo "$SSH_KNOWN_HOSTS" > ~/.ssh/known_hosts\n  script:\n    - ssh "$DEPLOY_USER@$DEPLOY_HOST" "cd /srv/app && git pull && ./restart.sh"\n  environment: production\n  when: manual',
  },
];

const BB = [
  { id: 'checkout', label: 'Checkout: глубина клона', text: 'clone:\n  depth: 20' },
  { id: 'cache', label: 'Кэширование зависимостей', text: 'caches:\n  - node' },
  { id: 'docker', label: 'Шаг: сборка Docker-образа', text: '- step:\n    name: Сборка образа\n    services: [docker]\n    script:\n      - docker build -t app:$BITBUCKET_COMMIT .' },
  {
    id: 'ssh',
    label: 'Шаг: деплой по SSH',
    text: "- step:\n    name: Деплой\n    deployment: production\n    trigger: manual\n    script:\n      - pipe: atlassian/ssh-run:0.8.1\n        variables:\n          SSH_USER: $DEPLOY_USER\n          SERVER: $DEPLOY_HOST\n          COMMAND: 'cd /srv/app && git pull && ./restart.sh'",
  },
];

export function snippetsFor(system) {
  if (system === 'gitlab') return GL;
  if (system === 'bitbucket') return BB;
  if (system === 'github' || system === 'gitea' || system === 'forgejo') return GH;
  return [];
}

/** Ключи, после которых редактор подсказывает метки раннеров */
export const TAG_KEYS = { gitlab: ['tags'], github: ['runs-on'], gitea: ['runs-on'], forgejo: ['runs-on'], bitbucket: ['runs-on'] };
