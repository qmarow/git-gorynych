// Эталон для tests/load_parity.rs: настоящие previewCi (electron/ci.cjs) и YAML.stringify (toYaml) из electron/vendor/yaml.cjs.
// Проверка конфигурации (ciCheck.cjs) здесь подменена заглушкой: она сверяется отдельно.
// Запуск из корня репозитория:
//   node crates/gorynych-ci-linter/tests/fixtures/gen-load-parity.cjs            — load-parity.json: случаи из файла и каждая 40-я подмена значения
//   node crates/gorynych-ci-linter/tests/fixtures/gen-load-parity.cjs <выход.json> — все подмены значений (см. тест load_mutations_full)
//   node crates/gorynych-ci-linter/tests/fixtures/gen-load-parity.cjs <выход.json> <папка> — настоящие файлы из папки, каждый как файл каждой системы (тот же тест)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../../../..');
const YAML = require(path.join(root, 'electron/vendor/yaml.cjs'));
const checkPath = require.resolve(path.join(root, 'electron/ciCheck.cjs'));
if (!globalThis.__GORYNYCH_REAL_CHECK) require.cache[checkPath] = { id: checkPath, filename: checkPath, loaded: true, exports: { checkCi: async () => ({}) } };
const { previewCi } = require(path.join(root, 'electron/ci.cjs'));
const { setLanguage } = require(path.join(root, 'electron/i18n.cjs'));

const GITLAB = `include:
  - local: ci/common.yml
  - template: Auto-DevOps.gitlab-ci.yml
stages: [build, test, deploy]
variables:
  GLOBAL: "1"
  NUMBER: 5
  DESCRIBED:
    value: x
    description: Описание
    options: [x, y]
default:
  image: node:20
  tags: [docker, linux]
  before_script:
    - npm ci
  services:
    - postgres:16
workflow:
  name: Пайплайн $CI_COMMIT_REF_NAME
  rules:
    - if: $CI_COMMIT_BRANCH
      when: always
    - changes: [src/**/*]
    - exists:
        paths: [Dockerfile]
      variables:
        A: 1
    - when: never
.base:
  image:
    name: alpine:3
  script: [echo base]
  variables:
    FROM_BASE: 1
build:
  extends: .base
  stage: build
  script:
    - echo build
    - !reference [.base, script]
  artifacts:
    paths: [dist/]
    expire_in: 1 week
    when: on_success
    reports:
      junit: report.xml
  cache:
    key: k
    paths: [node_modules/]
  retry: 2
  parallel: 3
  timeout: 1h
  coverage: '/x/'
  interruptible: true
  resource_group: g
  start_in: 5 minutes
  when: delayed
test:
  stage: test
  needs:
    - build
    - job: other
      optional: true
      artifacts: false
    - pipeline: other/project
    - project: a/b
      job: c
  dependencies: [build]
  rules:
    - if: $A == "1"
      when: manual
      allow_failure: true
    - if: $B
  script: echo test
  after_script: echo after
  environment:
    name: prod
    url: https://example.com
    action: start
  allow_failure:
    exit_codes: [1]
  retry:
    max: 2
  parallel:
    matrix:
      - A: [1, 2]
  only:
    refs: [main]
    variables: [$X]
  except: [tags]
  inherit:
    default: false
deploy:
  stage: unknown
  trigger:
    project: a/b
    branch: main
  environment: staging
  services:
    - name: redis:7
    - mysql
`;

const GITHUB = `name: CI
run-name: Запуск
on:
  push:
    branches: [main]
    tags: [v*]
    paths: [src/**]
  workflow_dispatch:
    inputs:
      level:
        type: string
  workflow_run:
    workflows: [Build]
  schedule:
    - cron: "0 0 * * *"
env:
  A: 1
concurrency:
  group: g
permissions:
  contents: read
jobs:
  build:
    name: Сборка
    runs-on: ubuntu-latest
    container: node:20
    if: github.ref == 'x'
    continue-on-error: true
    environment:
      name: prod
      url: https://example.com
    env:
      B: 2
    strategy:
      matrix:
        node: [18, 20]
        include:
          - node: 22
    services:
      redis:
        image: redis:7
    timeout-minutes: 5
    permissions: read-all
    outputs:
      out: x
    steps:
      - uses: actions/checkout@v4
        with:
          depth: 1
          ref: main
      - name: Шаг
        run: |
          echo 1
          echo 2
        if: always()
      - run: make
  test:
    needs: [build]
    runs-on:
      group: g
      labels: [self-hosted, linux]
    steps: []
  reuse:
    needs: [build, test, missing]
    uses: ./.github/workflows/x.yml
`;

const BITBUCKET = `image: node:20
definitions:
  services:
    redis:
      image: redis
pipelines:
  default:
    - step:
        name: Сборка
        image: alpine
        script:
          - echo 1
        after-script:
          - echo 2
        services: [docker]
        caches: [node]
        artifacts:
          - dist/**
        deployment: prod
        trigger: manual
        runs-on: [self.hosted]
        condition:
          changesets:
            includePaths: [src/**]
    - parallel:
        - step:
            script: [a]
        - step:
            name: b
            script: [b]
    - parallel:
        steps:
          - step:
              script: [c]
    - stage:
        name: Этап
        steps:
          - step:
              script: [d]
    - stage:
        steps:
          - step:
              artifacts:
                paths: [x]
              script: [e]
  branches:
    main:
      - step:
          script: [f]
  tags:
    v*:
      - step:
          script: [g]
  custom:
    manual:
      - variables:
          - name: X
      - step:
          script: [h]
  pull-requests:
    "**":
      - step:
          script: [i]
  bookmarks:
    b:
      - step:
          script: [j]
`;

const CIRCLE = `version: 2.1
orbs:
  node: circleci/node@5
jobs:
  build:
    docker:
      - image: cimg/node:20
    environment:
      A: 1
    steps:
      - checkout
      - run: |
          echo 1
          echo 2
      - run:
          name: Шаг
          command: make
      - run:
          command: make2
      - node/install:
          version: 20
  mac:
    macos:
      xcode: 15
    steps: []
  vm:
    machine: true
workflows:
  version: 2
  main:
    jobs:
      - build
      - hold:
          type: approval
          requires: [build]
      - mac:
          name: Мак
          requires: [hold]
          filters:
            branches:
              only: [main]
              ignore: dev
      - node/test
`;

const AZURE_STAGES = `trigger:
  branches:
    include: [main]
pr: none
schedules:
  - cron: "0 0 * * *"
    displayName: Ночью
  - cron: "1 1 * * *"
pool:
  vmImage: ubuntu-latest
variables:
  - name: A
    value: 1
  - name: B
  - group: g
resources:
  repositories:
    - repository: r
      name: a/b
stages:
  - stage: Build
    displayName: Сборка
    jobs:
      - job: A
        displayName: Задание A
        pool: windows
        condition: succeeded()
        steps:
          - script: |
              echo 1
              echo 2
            displayName: Шаг
          - bash: echo 2
          - task: Npm@1
          - template: t.yml
          - powershell: dir
          - pwsh: dir2
      - deployment: D
        environment: prod
        container: node:20
        strategy:
          runOnce:
            deploy:
              steps:
                - script: deploy
      - template: j.yml
  - stage: Second
    jobs:
      - job: B
        environment:
          name: env
        variables:
          C: 1
        pool:
          name: own
`;

const AZURE_JOBS = `trigger: none
variables:
  A: 1
jobs:
  - job: A
    displayName: Первое
    steps:
      - script: a
  - job: B
    dependsOn: A
  - deployment: C
    displayName: Третье
    dependsOn: [A, B, missing]
`;

const AZURE_STEPS = `pool: linux
steps:
  - script: a
  - bash: b
`;

const JENKINS = `@Library('shared') _
@Library("other@1")
pipeline {
    agent any
    triggers {
        cron('H 4 * * 1-5')

        pollSCM('H/5 * * * *')
    }
    stages {
        stage('Build') {
            agent { docker { image 'node:20' } }
            when {
                branch 'main'
            }
            steps {
                sh 'echo "}" # скобка в строке'
                // комментарий с }
                sh """
                   многострочно }
                """
                sh '''тройные { '''
            }
        }
        stage("Тесты") {
            parallel {
                stage('A') {
                    steps { sh 'a' }
                }
                stage('B') {
                    agent  docker
                    steps { sh 'b' }
                }
            }
        }
        stage('Вложенные') {
            stages {
                stage('C') { steps { sh 'c' } }
                stage('D') {
                    input {
                        message 'да?'
                    }
                    steps { echo "😀 d" }
                }
            }
        }
        stage('Имя со { скобкой') {
            steps { sh 'e' }
        }
        stage('Пустой') { }
    }
}
`;

const SCRIPTED = `node {
    stage('A') {
        sh 'a'
    }
    stage('B') { input('x') }
}
`;

const CASES = [
  { name: 'нет CI', files: { 'README.md': '# x\n' } },
  { name: 'gitlab полный', files: { '.gitlab-ci.yml': GITLAB, 'ci/common.yml': 'variables:\n  FROM_INCLUDE: 1\n  GLOBAL: "0"\nincluded:\n  script: [a]\n' }, bothLanguages: true },
  { name: 'gitlab yaml', files: { '.gitlab-ci.yaml': 'a:\n  script: x\n' } },
  { name: 'gitlab оба файла', files: { '.gitlab-ci.yml': 'a:\n  script: x\n', '.gitlab-ci.yaml': 'b:\n  script: x\n' }, request: '.gitlab-ci.yaml' },
  { name: 'запрошен неизвестный файл', files: { '.gitlab-ci.yml': 'a:\n  script: x\n', '.travis.yml': 'a: 1\n' }, request: 'нет' },
  { name: 'запрошена вторая система', files: { '.gitlab-ci.yml': 'a:\n  script: x\n', '.travis.yml': 'a: 1\nb: 2\n' }, request: '.travis.yml', bothLanguages: true },
  { name: 'extends цепочка', files: { '.gitlab-ci.yml': '.a:\n  image: a\n  variables: {A: 1, B: 1}\n.b:\n  extends: .a\n  variables: {B: 2}\n.c:\n  stage: build\nj:\n  extends: [.b, .c, .a]\n  variables: {C: 3}\n  script: x\nk:\n  extends: j\n' } },
  { name: 'extends цикл', files: { '.gitlab-ci.yml': 'a:\n  extends: b\n  script: x\nb:\n  extends: c\nc:\n  extends: a\nd:\n  extends: d\n' }, bothLanguages: true },
  { name: 'extends неизвестный', files: { '.gitlab-ci.yml': 'a:\n  extends: [нет, 1, null]\n  script: x\n' }, bothLanguages: true },
  { name: 'reference', files: { '.gitlab-ci.yml': '.t:\n  script: [a, b]\n  rules:\n    - if: $X\n  nested: {x: {y: [1]}}\n  name: abc\nj:\n  script:\n    - !reference [.t, script]\n    - c\n    - - d\n      - !reference [.t, script]\n  rules: !reference [.t, rules]\n  variables:\n    A: !reference [.t, nested, x, y, 0]\n    L: !reference [.t, script, length]\n    C: !reference [.t, name, 0]\n  tags: !reference [нет, script]\n  image: !reference [.t, нет]\nk:\n  script: !reference [variables, X]\nvariables:\n  X: !reference [default, image]\n  Y: !reference [.t, script]\ndefault:\n  image: i\n' }, bothLanguages: true },
  { name: 'reference цикл', files: { '.gitlab-ci.yml': 'a:\n  script: !reference [b, script]\nb:\n  script: !reference [a, script]\n' } },
  { name: 'reference числа и пусто', files: { '.gitlab-ci.yml': 'a:\n  script: !reference []\nb:\n  script: !reference [1, 2]\n1:\n  2: x\n  script: y\nc:\n  script: !reference [null, x]\n' } },
  { name: 'этап не объявлен', files: { '.gitlab-ci.yml': 'stages: [a, .pre, .post, b]\nj:\n  stage: c\n  script: x\nk:\n  stage: .pre\n  script: x\nl:\n  stage: d\n  script: x\n' }, bothLanguages: true },
  { name: 'этапы по умолчанию', files: { '.gitlab-ci.yml': 'j:\n  stage: build\n  script: x\nk:\n  script: x\nl:\n  stage: .post\n  script: x\n' } },
  { name: 'types вместо stages', files: { '.gitlab-ci.yml': 'types: [a, 1, null]\nj:\n  stage: 1\n  script: x\n' } },
  { name: 'needs неизвестный', files: { '.gitlab-ci.yml': 'a:\n  script: x\n  needs: [нет, {job: b, optional: true}, {job: c}, {pipeline: d}, {project: e, job: f}, 5, []]\nb:\n  needs: []\n  script: x\n' }, bothLanguages: true },
  { name: 'inherit варианты', files: { '.gitlab-ci.yml': 'image: g\nservices: [s]\nbefore_script: [b]\nafter_script: [a]\ncache: {key: x}\ndefault:\n  tags: [t]\nj1:\n  script: x\n  inherit: {default: false}\nj2:\n  script: x\n  inherit: {default: [image]}\nj3:\n  script: x\n  inherit: {default: true}\nj4:\n  script: x\n  inherit: нет\nj5:\n  script: x\n  image: null\n  before_script: null\n  services: null\n  tags: null\n' }, bothLanguages: true },
  { name: 'include разные', files: { '.gitlab-ci.yml': 'include:\n  - a.yml\n  - /b.yml\n  - http://x/y.yml\n  - HTTPS://x/y.yml\n  - project: p/q\n    ref: main\n    file: [f1, f2]\n  - project: p/r\n    file: f\n  - remote: https://x/z.yml\n  - template: T.yml\n  - component: c/d@1\n  - local: нет.yml\n    rules:\n      - if: $X\n  - unknown: 1\n  - 5\n  - [1, 2]\n  - null\nj:\n  script: x\n', 'a.yml': 'ja:\n  script: a\n', 'b.yml': 'jb:\n  script: b\n' }, bothLanguages: true },
  { name: 'include строкой', files: { '.gitlab-ci.yml': 'include: a.yml\nj:\n  script: x\n', 'a.yml': 'j:\n  script: y\n  image: z\nk:\n  script: a\n' } },
  { name: 'include порядок и слияние', files: { '.gitlab-ci.yml': 'include: [a.yml, b.yml]\nvariables: {M: 1}\nstages: [m]\nj:\n  stage: m\n  script: m\n', 'a.yml': 'variables: {A: 1, M: 0}\nstages: [a]\nj:\n  image: a\n  script: a\n', 'b.yml': 'include: a.yml\nvariables: {B: 1}\ndefault: {tags: [b]}\nj:\n  image: b\n' } },
  { name: 'include glob', files: { '.gitlab-ci.yml': 'include:\n  - local: ci/*.yml\n  - local: "deep/**/*.yml"\n  - local: x?.yml\n  - local: "***/q.yml"\n  - local: "нет/*.yml"\nj:\n  script: x\n', 'ci/b.yml': 'b:\n  script: x\n', 'ci/a.yml': 'a:\n  script: x\n', 'ci/sub/c.yml': 'c:\n  script: x\n', 'deep/d.yml': 'd:\n  script: x\n', 'deep/1/2/3/4/5/6/e.yml': 'e:\n  script: x\n', 'deep/1/2/3/4/5/6/7/f.yml': 'f:\n  script: x\n', 'x1.yml': 'x1:\n  script: x\n', 'x22.yml': 'x2:\n  script: x\n', 'node_modules/n.yml': 'n:\n  script: x\n', 'r/q.yml': 'q:\n  script: x\n' } },
  { name: 'include глубина', files: Object.fromEntries([...Array(9).keys()].map((i) => [i === 0 ? '.gitlab-ci.yml' : `f${i}.yml`, `include: f${i + 1}.yml\nj${i}:\n  script: x\n`])), bothLanguages: true },
  { name: 'include цикл', files: { '.gitlab-ci.yml': 'include: a.yml\nj:\n  script: x\n', 'a.yml': 'include: .gitlab-ci.yml\nk:\n  script: x\n' } },
  { name: 'include наружу', files: { '.gitlab-ci.yml': 'include: ../outside.yml\nj:\n  script: x\n', '../outside.yml': 'k:\n  script: x\n' }, bothLanguages: true },
  { name: 'include большой файл', files: { '.gitlab-ci.yml': 'include: big.yml\nj:\n  script: x\n', 'big.yml': `# ${'x'.repeat(600 * 1024)}\n` }, bothLanguages: true, dropFileText: true },
  { name: 'include local не строка', files: { '.gitlab-ci.yml': 'include:\n  - local: 5\nj:\n  script: x\n' } },
  { name: 'основной файл большой', files: { '.gitlab-ci.yml': `# ${'x'.repeat(600 * 1024)}\n` }, bothLanguages: true, dropFileText: true },
  { name: 'github большой файл', files: { '.github/workflows/a.yml': `# ${'x'.repeat(600 * 1024)}\n` }, bothLanguages: true, dropFileText: true },
  { name: 'needs null падает', files: { '.gitlab-ci.yml': 'j:\n  script: x\n  needs: [null]\n' } },
  { name: 'trigger null падает', files: { '.gitlab-ci.yml': 'j:\n  trigger: null\n' } },
  { name: 'trigger варианты', files: { '.gitlab-ci.yml': 'a:\n  trigger: p/q\nb:\n  trigger: {project: p/q}\nc:\n  trigger: {include: f.yml}\nd:\n  trigger: {strategy: depend}\ne:\n  trigger: 5\nf:\n  trigger: []\n' } },
  { name: 'не задания', files: { '.gitlab-ci.yml': 'a: 1\nb: [1]\nc: null\nd: строка\n.t: 1\nj:\n  script: x\n' } },
  { name: 'пустой файл', files: { '.gitlab-ci.yml': '' }, bothLanguages: true },
  { name: 'корень не словарь', files: { '.gitlab-ci.yml': '- a\n- b\n' } },
  { name: 'слияние и алиас', files: { '.gitlab-ci.yml': '.t: &t\n  image: i\n  script: [a]\nj:\n  <<: *t\n  stage: build\nk:\n  <<: *t\n  image: k\n' } },
  { name: 'повтор ключей', files: { '.gitlab-ci.yml': 'j:\n  script: a\nj:\n  image: b\nvariables: {A: 1}\nvariables: {B: 2}\n' } },
  { name: 'числовые имена заданий', files: { '.gitlab-ci.yml': '10:\n  script: x\n2:\n  script: y\nb:\n  script: z\n1.5:\n  script: q\n' } },
  { name: 'BOM', files: { '.gitlab-ci.yml': '\uFEFFj:\n  script: x\n' } },
  { name: 'CRLF', files: { '.gitlab-ci.yml': 'j:\r\n  script: x\r\n  variables:\r\n    A: 1\r\n' } },
  { name: 'черновик', files: { '.gitlab-ci.yml': 'j:\n  script: диск\n', 'a.yml': 'a:\n  script: диск\n' }, drafts: { './.gitlab-ci.yml': 'include: a.yml\nk:\n  script: черновик\n', 'a.yml': '\uFEFFb:\n  script: черновик\n' } },
  { name: 'черновик с обратной чертой', files: { '.github/workflows/a.yml': 'jobs: {}\n' }, drafts: { '.github\\workflows\\a.yml': 'name: x\njobs: {}\n', '/.github/workflows/b.yml': 'name: нет\n' } },
  { name: 'черновик включения без файла', files: { '.gitlab-ci.yml': 'include: новый.yml\nj:\n  script: x\n' }, drafts: { 'новый.yml': 'k:\n  script: y\n' } },
  { name: 'github полный', files: { '.github/workflows/ci.yml': GITHUB }, bothLanguages: true },
  { name: 'github on формы', files: { '.github/workflows/a.yml': 'on: push\njobs: {}\n', '.github/workflows/b.yaml': 'on: [push, pull_request, 1]\n', '.github/workflows/C.YML': '"on": {push: null, x: 1}\njobs: 1\n', '.github/workflows/d.txt': 'x', '.github/workflows/e.yml': 'true: push\njobs:\n  a: 1\n  b: null\n' }, request: '.github/workflows/b.yaml', bothLanguages: true },
  { name: 'github on словарь с true', files: { '.github/workflows/e.yml': 'true: push\njobs:\n  a: 1\n  b: null\n  c:\n    needs: a\n' } },
  { name: 'github on пропущен', files: { '.github/workflows/C.YML': '"on": {push: null, x: 1}\njobs: 1\n' } },
  { name: 'github цикл needs', files: { '.github/workflows/a.yml': 'jobs:\n  a:\n    needs: c\n  b:\n    needs: a\n  c:\n    needs: b\n  d:\n    name: a\n    needs: [b]\n  e:\n    needs: [a, a]\n' } },
  { name: 'github одинаковые имена', files: { '.github/workflows/a.yml': 'jobs:\n  a:\n    name: X\n  b:\n    name: X\n    needs: a\n  c:\n    name: Y\n    needs: b\n' } },
  { name: 'gitea', files: { '.gitea/workflows/b.yaml': 'jobs:\n  a:\n    runs-on: x\n', '.gitea/workflows/a.yml': 'jobs:\n  b:\n    runs-on: [y, 1]\n' } },
  { name: 'forgejo', files: { '.forgejo/workflows/z.yml': 'name: f\non: push\njobs:\n  a:\n    runs-on: {labels: docker}\n' } },
  { name: 'bitbucket полный', files: { 'bitbucket-pipelines.yml': BITBUCKET }, bothLanguages: true },
  { name: 'bitbucket без pipelines', files: { 'bitbucket-pipelines.yml': 'image: {name: x}\n' }, bothLanguages: true },
  { name: 'circle полный', files: { '.circleci/config.yml': CIRCLE }, bothLanguages: true },
  { name: 'circle без потоков', files: { '.circleci/config.yaml': 'jobs:\n  a:\n    steps: [x, 5, {y: 1}, null, [z]]\n  b: null\n' }, bothLanguages: true },
  { name: 'circle null в потоке падает', files: { '.circleci/config.yml': 'workflows:\n  w:\n    jobs:\n      - null\n' } },
  { name: 'circle странные записи', files: { '.circleci/config.yml': 'workflows:\n  w:\n    jobs:\n      - 5\n      - [a]\n      - {}\n      - a: null\n      - a: x\n  q: 1\n' } },
  { name: 'azure этапы', files: { 'azure-pipelines.yml': AZURE_STAGES }, bothLanguages: true },
  { name: 'azure задания', files: { 'azure-pipelines.yaml': AZURE_JOBS }, bothLanguages: true },
  { name: 'azure шаги', files: { 'azure-pipelines.yml': AZURE_STEPS }, bothLanguages: true },
  { name: 'azure пусто', files: { 'azure-pipelines.yml': 'pool: {x: 1}\n' } },
  { name: 'azure репозиторий null падает', files: { 'azure-pipelines.yml': 'resources:\n  repositories: [null]\n' } },
  { name: 'azure репозиторий без полей', files: { 'azure-pipelines.yml': 'resources:\n  repositories: [5, {}]\n' } },
  { name: 'jenkins декларативный', files: { Jenkinsfile: JENKINS }, bothLanguages: true },
  { name: 'jenkins CRLF', files: { Jenkinsfile: JENKINS.replace(/\n/g, '\r\n') } },
  { name: 'jenkins скриптовый', files: { Jenkinsfile: SCRIPTED }, bothLanguages: true },
  { name: 'jenkins без этапов', files: { Jenkinsfile: 'echo 1\n' }, bothLanguages: true },
  { name: 'jenkins незакрытый', files: { Jenkinsfile: "pipeline {\n  agent { label 'x' }\n  stages {\n    stage('A') {\n      steps { sh 'a'\n" } },
  { name: 'jenkins пробелы', files: { Jenkinsfile: "stage ( \"a\" ) \t{\n\u00A0\u00A0steps {\n\n\n\u3000 x\n\u3000\n\n\n  y\n}\n  when {\n\n}\nagent {\n  a  b\n  c\n}\n}\nstage('b'){ agent  x }\nstage('c'){ agent { } }\nstage('d'){ input 'q' }\nstage('e'){ inputs('q') }\n" } },
  { name: 'jenkins повтор текста', files: { Jenkinsfile: "stage('a') {\n stage('b') { x }\n}\nstage('c') {\n parallel { }\n stage('b') { x }\n stage('b') { x }\n}\n" } },
  { name: 'travis', files: { '.travis.yml': 'language: node\nscript: x\n' }, bothLanguages: true },
  { name: 'drone', files: { '.drone.yml': 'kind: pipeline\n' } },
  { name: 'drone пустой', files: { '.drone.yml': '' } },
  { name: 'woodpecker', files: { '.woodpecker.yml': 'a: 1\n', '.woodpecker/b.yaml': 'b: 1\n', '.woodpecker/a.yml': 'c: 1\n', '.woodpecker/Z.yml': 'd: 1\n', '.woodpecker/я.yml': 'e: 1\n', '.woodpecker/x.json': '{}' }, request: '.woodpecker/я.yml' },
  { name: 'папка вместо файла', files: { '.gitlab-ci.yml/x': 'a', 'Jenkinsfile/y': 'b', '.github/workflows/d.yml/z': 'c', '.drone.yml': 'a: 1\n' } },
  { name: 'все системы', files: { '.gitlab-ci.yml': 'j:\n  script: x\n', '.github/workflows/a.yml': 'jobs: {}\n', '.gitea/workflows/a.yml': 'jobs: {}\n', '.forgejo/workflows/a.yml': 'jobs: {}\n', Jenkinsfile: '', 'bitbucket-pipelines.yml': '', '.circleci/config.yml': '', 'azure-pipelines.yml': '', '.travis.yml': '', '.drone.yml': '', '.woodpecker.yml': '' }, bothLanguages: true },
  { name: 'анти-UTF8', files: { '.gitlab-ci.yml': { base64: Buffer.from([0x6a, 0x3a, 0x0a, 0x20, 0x20, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74, 0x3a, 0x20, 0xff, 0xd0, 0x0a]).toString('base64') } } },
  // Сломанный YAML: текст ошибки другой, см. шапку yaml.rs
  { name: 'сломанный YAML', files: { '.gitlab-ci.yml': 'j:\n  script: x\nk:\n  script: "незакрытая\n' }, loose: true },
];

/* ------------------------------ Подмена значений ------------------------------ */

const ODD = [null, 0, 1.5, '', 'строка', true, false, [], {}, [null], [1, 'a'], { x: 1 }, 'a\nb', 'manual', { name: 'n', job: 'j', paths: ['p'], labels: ['l'] }];
const BASES = [
  ['.gitlab-ci.yml', GITLAB, { 'ci/common.yml': 'included:\n  script: [a]\n' }],
  ['.github/workflows/ci.yml', GITHUB, {}],
  ['bitbucket-pipelines.yml', BITBUCKET, {}],
  ['.circleci/config.yml', CIRCLE, {}],
  ['azure-pipelines.yml', AZURE_STAGES, {}],
  ['azure-pipelines.yml', AZURE_JOBS, {}],
  ['azure-pipelines.yml', AZURE_STEPS, {}],
];

function* paths(value, prefix = []) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      yield [...prefix, i];
      yield* paths(value[i], [...prefix, i]);
    }
  } else if (value && typeof value === 'object' && !value.__reference) {
    for (const key of Object.keys(value)) {
      yield [...prefix, key];
      yield* paths(value[key], [...prefix, key]);
    }
  }
}

function setIn(value, keyPath, next) {
  const copy = structuredClone(value);
  let target = copy;
  for (const key of keyPath.slice(0, -1)) target = target[key];
  target[keyPath[keyPath.length - 1]] = next;
  return copy;
}

function mutationCases() {
  const out = [];
  for (const [file, text, extra] of BASES) {
    const plain = YAML.parse(text, { logLevel: 'error', customTags: [{ tag: '!reference', collection: 'seq', resolve: (s) => s.toJSON() }] });
    for (const keyPath of paths(plain)) {
      for (const odd of ODD) {
        const content = YAML.stringify(setIn(plain, keyPath, odd), { lineWidth: 0, aliasDuplicateObjects: false });
        out.push({ name: `${file} ${JSON.stringify(keyPath)} = ${JSON.stringify(odd)}`, files: { [file]: content, ...extra } });
      }
    }
  }
  return out;
}

/* ----------------------------------- Запись ----------------------------------- */

function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof content === 'string' ? content : Buffer.from(content.base64, 'base64'));
  }
}

async function record(testCase, language) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gorynych-load-'));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  try {
    writeFiles(repo, testCase.files);
    setLanguage(language);
    const result = await previewCi(repo, testCase.request ?? '', testCase.drafts ?? {});
    if (result.current) delete result.current.check;
    if (testCase.dropFileText) for (const f of result.current.files) if (f.text.length > 1000) f.text = null;
    const { dropFileText: _, ...rest } = testCase;
    // Большие файлы не хранятся текстом: достаточно размера
    const files = Object.fromEntries(Object.entries(rest.files).map(([k, v]) => [k, typeof v === 'string' && v.length > 500 * 1024 ? { big: v.length } : v]));
    return { ...rest, files, language, dropFileText: Boolean(testCase.dropFileText), result: JSON.parse(JSON.stringify(result)) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* --------------------------------- YAML.stringify --------------------------------- */

const STRINGS = ['', ' ', 'a', 'a b', ' a', 'a ', '\ta', 'a\t', 'null', '~', 'true', 'True', 'yes', '1', '1.5', '0x1f', '0o7', '1e3', '.inf', '.nan', '.', '-', '?', '- a', '? a', '-a', '?a', ':', 'a:', ':a', 'a: b', 'a:b', '#', 'a #b', 'a#b', ',', '[', ']', '{', '}', '[a]', '{a}', 'a,b', '&a', '*a', '!a', '|', '>', "'", '"', "'a'", '"a"', "it's", 'say "x"', `"'`, '%', '%a', '---', '--- a', '...', '...a', '@a', '`a', 'ж', 'жж: я', '😀',
  '\n', '\n\n', 'a\n', 'a\n\n', '\na', '\n\na', 'a\nb', 'a\n\nb', 'a\nb\n', 'a\nb\n\n', ' a\nb', '  a\nb', 'a\n b', 'a\n  b\nc', 'a \nb', 'a\t\nb', 'a\n ', 'a\n\t', 'a  ', 'a\nb  ', 'a\nb ', '\n a', ' \na', '---\na', 'a\n---', 'a\n...\nb', '%x\ny', 'a\n%b', '# x\ny', 'x\n# y', 'a: b\nc', 'a\nc: d', "it's\nx", 'say "x"\ny', `'"\nz`, '"\n"', 'a\rb', 'a\r\nb', '\r', 'a\u2028b', 'a\u2028---', 'a\u0085b', 'a\u00A0b',
  '\u0000', 'a\u0001b', '\u0007', '\u000b', '\u001b', '\u007f', '\u0080', '\u009f', 'a\u0001\nb', 'a\u0001 \nb', 'длинная строка с \u0001 и переводом\nвторая строка длинная достаточно', 'длинная строка с \u0001 и пробелом \nвторая строка длинная достаточно', 'длинная строка с \u0001\n\n\nтри перевода строки и ещё текст', 'длинная строка с \u0001\n ведущий пробел в строке и ещё текст', 'короткая\u0001\nx', 'длинная строка с кавычками \u0001 " и \' внутри\nвторая',
  'длинная строка "с кавычкой" и пробелом перед переводом \nвторая часть', 'длинная \'с кавычкой\' \n и "двойной"\n\n\nчасть', 'k'.repeat(1100), `${'k'.repeat(1100)}\u0001`, 'a'.repeat(200), `${'a '.repeat(100)}b`];

let seed = 12345;
const random = (n) => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % n;
};
const ALPHABET = ['a', 'b', ' ', ' ', '\n', '\n', '\t', ':', '#', '-', '"', "'", '%', '.', '?', 'ж', '\u0001', '\u007f', '0', '1', '|', '>', '&', '*', '!', '[', '{', ',', '~'];
for (let i = 0; i < 1000; i++) {
  let text = '';
  const length = 1 + random(i % 10 === 0 ? 48 : 8);
  for (let k = 0; k < length; k++) text += ALPHABET[random(ALPHABET.length)];
  STRINGS.push(text);
}

const toYaml = (v) => YAML.stringify(v, { lineWidth: 0 }).trimEnd();

function stringifyCases() {
  const out = [];
  const add = (value) => out.push({ value, text: toYaml(value) });
  for (const s of STRINGS) {
    add(s);
    add({ k: s });
    add({ [s]: 1 });
    add({ a: { [s]: s } });
    add([s, s]);
    add({ a: [{ [s]: s, b: [s] }] });
    add([[s]]);
  }
  for (const value of [null, true, false, 0, 1, -1, 1.5, 1e21, 1e-7, 100, [], {}, [[]], [{}], { a: [] }, { a: {} }, { a: null }, { a: null, b: null }, [null], [null, null], { a: [[], {}] }, [[1, 2], [3, [4, 5]], { a: 1, b: { c: 2 } }], { '1': 2, b: 3, '0': 4 }, { a: { b: { c: { d: [1, { e: 2 }] } } } }, { __reference: ['.a', 'b'] }]) add(value);
  return out;
}

async function main() {
  const [output, realDir] = process.argv.slice(2);
  if (realDir) {
    const targets = ['.gitlab-ci.yml', '.github/workflows/ci.yml', 'bitbucket-pipelines.yml', '.circleci/config.yml', 'azure-pipelines.yml', '.drone.yml'];
    const cases = [];
    for (const name of fs.readdirSync(realDir)) {
      const text = fs.readFileSync(path.join(realDir, name), 'utf8');
      for (const target of targets) {
        const recorded = await record({ name: `${name} как ${target}`, files: { [target]: text } }, 'ru');
        // Текст ошибки YAML другой, см. шапку yaml.rs
        recorded.loose = recorded.result.current.errors.length > 0;
        cases.push(recorded);
      }
    }
    fs.writeFileSync(output, `${JSON.stringify({ cases })}
`);
    console.log(`случаев ${cases.length}, сломанных ${cases.filter((c) => c.loose).length}`);
    return;
  }
  const mutations = mutationCases();
  if (output) {
    const cases = [];
    for (const c of mutations) cases.push(await record(c, 'ru'));
    fs.writeFileSync(output, `${JSON.stringify({ cases })}\n`);
    console.log(`подмен ${cases.length}`);
    return;
  }
  const cases = [];
  for (const c of CASES) {
    cases.push(await record(c, 'ru'));
    if (c.bothLanguages) cases.push(await record(c, 'en'));
  }
  const sampled = mutations.filter((_, i) => i % 40 === 0);
  const mutated = [];
  for (const c of sampled) mutated.push(await record(c, 'ru'));
  const stringify = stringifyCases();
  fs.writeFileSync(path.join(__dirname, 'load-parity.json'), `${JSON.stringify({ cases, mutated, stringify })}\n`);
  console.log(`случаев ${cases.length}, подмен ${mutated.length} из ${mutations.length}, stringify ${stringify.length}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { CASES, BASES, ODD, mutationCases, writeFiles, previewCi, setLanguage, YAML, root };
