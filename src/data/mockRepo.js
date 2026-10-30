// Демо-данные, пока не подключён настоящий Git.
// Коммиты идут от новых к старым (как в git log --topo-order).

const now = Date.now();
const h = (hours) => new Date(now - hours * 3600 * 1000).toISOString();

const people = {
  alex: { name: 'Alex Morozov', email: 'alex@example.com' },
  maria: { name: 'Maria Ivanova', email: 'maria@example.com' },
  dmitry: { name: 'Dmitry Sokolov', email: 'dmitry@example.com' },
};

export const repo = {
  name: 'gitidea',
  currentBranch: 'feature/commit-graph',
  localBranches: [
    { name: 'feature/commit-graph', ahead: 2, behind: 0 },
    { name: 'feature/sidebar', ahead: 0, behind: 0 },
    { name: 'develop', ahead: 0, behind: 1 },
    { name: 'main', ahead: 0, behind: 0 },
  ],
  remotes: [
    {
      name: 'origin',
      branches: ['main', 'develop', 'feature/sidebar', 'hotfix/titlebar'],
    },
  ],
  stashes: [
    { id: 'stash@{0}', message: 'WIP on develop: experimental zoom' },
    { id: 'stash@{1}', message: 'On main: temp debug logging' },
  ],
  tags: ['v0.2.0', 'v0.1.0'],
};

export const wipFiles = [
  { path: 'src/components/CommitGraph.jsx', status: 'M' },
  { path: 'src/lib/graphLayout.js', status: 'M' },
  { path: 'src/components/GraphTooltip.jsx', status: 'A' },
  { path: 'src/legacy/oldGraph.js', status: 'D' },
];

export const commits = [
  {
    hash: 'a1f3c9e4d2b7',
    parents: ['7b2e10ac93f1'],
    message: 'Render bezier edges between graph lanes',
    description: 'Edges now curve smoothly when a branch forks off or merges back in.',
    author: people.alex,
    date: h(1),
    refs: [
      { type: 'local', name: 'feature/commit-graph', head: true },
    ],
    files: [
      { path: 'src/components/CommitGraph.jsx', status: 'M', additions: 64, deletions: 12 },
      { path: 'src/lib/graphLayout.js', status: 'M', additions: 22, deletions: 4 },
    ],
  },
  {
    hash: 'c84d6f02e7a5',
    parents: ['e5a91b3c7d02', '5f0c2d8e1a96'],
    message: "Merge branch 'feature/sidebar' into develop",
    description: '',
    author: people.maria,
    date: h(3),
    refs: [
      { type: 'local', name: 'develop' },
      { type: 'remote', name: 'origin/develop' },
    ],
    files: [
      { path: 'src/components/Sidebar.jsx', status: 'A', additions: 142, deletions: 0 },
      { path: 'src/App.jsx', status: 'M', additions: 8, deletions: 2 },
    ],
  },
  {
    hash: '5f0c2d8e1a96',
    parents: ['3d7a4b9c0e18'],
    message: 'Add collapsible sections to sidebar',
    description: 'LOCAL / REMOTE / STASHES / TAGS can now be collapsed.',
    author: people.maria,
    date: h(5),
    refs: [
      { type: 'local', name: 'feature/sidebar' },
      { type: 'remote', name: 'origin/feature/sidebar' },
    ],
    files: [{ path: 'src/components/Sidebar.jsx', status: 'M', additions: 37, deletions: 9 }],
  },
  {
    hash: '7b2e10ac93f1',
    parents: ['0e6f8a2b4c71'],
    message: 'Add lane allocation algorithm',
    description: 'Assigns each commit a column so branches never overlap.',
    author: people.alex,
    date: h(6),
    refs: [],
    files: [{ path: 'src/lib/graphLayout.js', status: 'A', additions: 58, deletions: 0 }],
  },
  {
    hash: '3d7a4b9c0e18',
    parents: ['e5a91b3c7d02'],
    message: 'Sidebar: list remote branches',
    description: '',
    author: people.maria,
    date: h(8),
    refs: [],
    files: [
      { path: 'src/components/Sidebar.jsx', status: 'M', additions: 21, deletions: 3 },
      { path: 'src/data/mockRepo.js', status: 'M', additions: 6, deletions: 0 },
    ],
  },
  {
    hash: 'e5a91b3c7d02',
    parents: ['9c3b5e7f1a24'],
    message: 'Configure electron-builder for NSIS installer',
    description: 'Adds win/nsis targets and an electron:build script.',
    author: people.dmitry,
    date: h(20),
    refs: [],
    files: [{ path: 'package.json', status: 'M', additions: 31, deletions: 1 }],
  },
  {
    hash: '0e6f8a2b4c71',
    parents: ['9c3b5e7f1a24'],
    message: 'Scaffold CommitGraph component',
    description: '',
    author: people.alex,
    date: h(22),
    refs: [],
    files: [{ path: 'src/components/CommitGraph.jsx', status: 'A', additions: 40, deletions: 0 }],
  },
  {
    hash: 'b49e2c7a0f53',
    parents: ['2a8d0f6b3e95', 'd61c3a9e5b07'],
    message: "Merge branch 'hotfix/titlebar'",
    description: '',
    author: people.dmitry,
    date: h(30),
    refs: [
      { type: 'local', name: 'main' },
      { type: 'remote', name: 'origin/main' },
      { type: 'tag', name: 'v0.2.0' },
    ],
    files: [{ path: 'electron/main.cjs', status: 'M', additions: 4, deletions: 2 }],
  },
  {
    hash: 'd61c3a9e5b07',
    parents: ['2a8d0f6b3e95'],
    message: 'Fix maximize button state on Windows',
    description: 'Listen to maximize/unmaximize events and forward them over IPC.',
    author: people.dmitry,
    date: h(34),
    refs: [{ type: 'remote', name: 'origin/hotfix/titlebar' }],
    files: [
      { path: 'electron/main.cjs', status: 'M', additions: 4, deletions: 2 },
      { path: 'electron/preload.cjs', status: 'M', additions: 7, deletions: 0 },
    ],
  },
  {
    hash: '9c3b5e7f1a24',
    parents: ['4f7a1d9b2c68'],
    message: 'Add Tailwind theme tokens',
    description: '',
    author: people.maria,
    date: h(48),
    refs: [],
    files: [{ path: 'src/index.css', status: 'M', additions: 26, deletions: 3 }],
  },
  {
    hash: '4f7a1d9b2c68',
    parents: ['2a8d0f6b3e95'],
    message: 'Set up Vite + React',
    description: '',
    author: people.alex,
    date: h(60),
    refs: [],
    files: [
      { path: 'vite.config.js', status: 'A', additions: 18, deletions: 0 },
      { path: 'src/main.jsx', status: 'A', additions: 10, deletions: 0 },
      { path: 'index.html', status: 'M', additions: 3, deletions: 8 },
    ],
  },
  {
    hash: '2a8d0f6b3e95',
    parents: ['8e1f4c7a6d30'],
    message: 'Initial window and IPC bridge',
    description: '',
    author: people.dmitry,
    date: h(80),
    refs: [{ type: 'tag', name: 'v0.1.0' }],
    files: [
      { path: 'electron/main.cjs', status: 'A', additions: 52, deletions: 0 },
      { path: 'electron/preload.cjs', status: 'A', additions: 14, deletions: 0 },
    ],
  },
  {
    hash: '8e1f4c7a6d30',
    parents: [],
    message: 'Initial commit',
    description: '',
    author: people.alex,
    date: h(96),
    refs: [],
    files: [
      { path: 'README.md', status: 'A', additions: 5, deletions: 0 },
      { path: '.gitignore', status: 'A', additions: 4, deletions: 0 },
    ],
  },
];

// Строка "// WIP" сверху графа, как в GitKraken
export const wipCommit = {
  hash: 'WIP',
  wip: true,
  parents: [commits[0].hash],
  message: '// WIP',
  refs: [],
};
