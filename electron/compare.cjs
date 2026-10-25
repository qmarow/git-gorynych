// Сравнение двух любых коммитов: какие файлы и насколько отличаются, сколько коммитов между ними
const { git, getCommitFiles, HASH_RE } = require('./git.cjs');
const { GitError } = require('./errors.cjs');

const FS = '\x1f';
const MAX_LOG = 200;

async function info(cwd, hash) {
  const out = (await git(cwd, ['log', '-1', `--format=%H${FS}%s${FS}%an${FS}%aI`, hash])).trim();
  const [h, subject, author, date] = out.split(FS);
  return { hash: h, subject, author, date };
}

async function log(cwd, range) {
  const out = await git(cwd, ['log', '-n', String(MAX_LOG), `--format=%H${FS}%s${FS}%an${FS}%aI`, range]);
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [hash, subject, author, date] = l.split(FS);
      return { hash, subject, author, date };
    });
}

/** a — «было», b — «стало» */
async function compareCommits(cwd, { a, b }) {
  if (!HASH_RE.test(a ?? '') || !HASH_RE.test(b ?? '')) throw new GitError('Некорректный коммит', { code: 'BAD_ARGS' });
  if (a === b) throw new GitError('Выбран один и тот же коммит', { code: 'BAD_ARGS' });
  const [infoA, infoB, files, counts, base] = await Promise.all([
    info(cwd, a),
    info(cwd, b),
    getCommitFiles(cwd, b, a),
    git(cwd, ['rev-list', '--left-right', '--count', `${a}...${b}`]),
    git(cwd, ['merge-base', a, b]).then((x) => x.trim(), () => null),
  ]);
  const [onlyA, onlyB] = counts.trim().split(/\s+/).map(Number);
  const [logB, logA] = await Promise.all([onlyB ? log(cwd, `${a}..${b}`) : [], onlyA ? log(cwd, `${b}..${a}`) : []]);
  const additions = files.reduce((n, f) => n + (f.additions ?? 0), 0);
  const deletions = files.reduce((n, f) => n + (f.deletions ?? 0), 0);
  return {
    a: infoA,
    b: infoB,
    mergeBase: base,
    relation: base === a ? 'a-before-b' : base === b ? 'b-before-a' : 'diverged',
    onlyA,
    onlyB,
    commitsA: logA,
    commitsB: logB,
    files,
    additions,
    deletions,
  };
}

module.exports = { compareCommits };
