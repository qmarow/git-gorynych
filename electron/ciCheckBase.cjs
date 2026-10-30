// Проверка конфигурации CI/CD — общие части: позиции в файлах, опечатки, файлы репозитория, выражения rules:if.
//
// Каждая проблема — { id, severity, title, when, how, why, fix, file, line, job, scenario? }:
//   severity: 'error' — сломается наверняка (пайплайн не создастся, задание упадёт);
//             'warning' — скорее всего сломается или поведёт себя не так, как ожидают;
//             'info' — стоит знать (устаревшее, небезопасное, неочевидное).
//   when — когда проявится: при push, при запуске задания, в merge request…;
//   how — как это будет выглядеть (что покажет сервер / лог задания);
//   why — причина; fix — как исправить.
// Для GitLab дополнительно «прогоняются» сценарии (push в основную ветку, в другую ветку, MR, тег, расписание, вручную):
// какие задания попадут в пайплайн и не сломается ли его создание.
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('./vendor/yaml.cjs');
const { git } = require('./git.cjs');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const q = (s) => `«${s}»`;

/* =================== Опечатки: «возможно, имелось в виду» =================== */

/** Расстояние Дамерау — Левенштейна (вставка, удаление, замена, перестановка соседних) */
function distance(a, b) {
  a = String(a).toLowerCase();
  b = String(b).toLowerCase();
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 99;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Ближайшее из известных слов (или null) */
function suggest(word, known, max = 2) {
  let best = null;
  let bestD = Infinity;
  const w = String(word);
  for (const k of known) {
    const d = distance(w.replace(/[-_]/g, ''), String(k).replace(/[-_]/g, ''));
    const limit = Math.min(max, Math.max(1, Math.floor(String(k).length / 3)));
    if (d <= limit && d < bestD) {
      best = k;
      bestD = d;
    }
  }
  return best;
}
const didYouMean = (word, known) => {
  const s = suggest(word, known);
  return s ? ` Возможно, имелось в виду ${q(s)}.` : '';
};

/* =================== Позиции в файлах =================== */

class Positions {
  constructor(files) {
    this.texts = new Map(files.map((f) => [f.path, f.text]));
    this.docs = new Map();
  }
  doc(file) {
    if (!this.docs.has(file)) {
      const text = this.texts.get(file);
      if (text == null) {
        this.docs.set(file, null);
      } else {
        const lineCounter = new YAML.LineCounter();
        let doc = null;
        try {
          doc = YAML.parseDocument(text, { lineCounter, uniqueKeys: false, customTags: [{ tag: '!reference', collection: 'seq', resolve: (s) => s }] });
        } catch {
          doc = null;
        }
        this.docs.set(file, doc ? { doc, lineCounter } : null);
      }
    }
    return this.docs.get(file);
  }
  /** Строка ключа/значения по пути [job, 'script', 2]; если пути нет — ближайший существующий родитель */
  line(file, keyPath) {
    const d = this.doc(file);
    if (!d) return null;
    for (let n = keyPath.length; n > 0; n--) {
      const sub = keyPath.slice(0, n);
      const parent = sub.length > 1 ? d.doc.getIn(sub.slice(0, -1), true) : d.doc.contents;
      if (YAML.isMap(parent)) {
        const pair = parent.items.find((p) => String(p.key?.value ?? p.key?.source) === String(sub.at(-1)));
        if (pair?.key?.range) return d.lineCounter.linePos(pair.key.range[0]).line;
      } else if (YAML.isSeq(parent)) {
        const item = parent.items[Number(sub.at(-1))];
        if (item?.range) return d.lineCounter.linePos(item.range[0]).line;
      }
    }
    return null;
  }
  /** Номер строки, где встречается текст (первое вхождение) */
  find(file, needle, from = 1) {
    const text = this.texts.get(file);
    if (!text) return null;
    const lines = text.split('\n');
    for (let i = Math.max(0, from - 1); i < lines.length; i++) if (lines[i].includes(needle)) return i + 1;
    return null;
  }
  /** Повторяющиеся ключи (YAML молча берёт последний) → [{ key, line, path }] */
  duplicates(file) {
    const d = this.doc(file);
    const out = [];
    if (!d) return out;
    const walk = (node, keyPath, depth) => {
      if (depth > 4) return;
      if (YAML.isMap(node)) {
        const seen = new Map();
        for (const pair of node.items) {
          const k = String(pair.key?.value ?? pair.key?.source);
          if (k === '<<') continue;
          if (seen.has(k)) out.push({ key: k, path: keyPath, line: pair.key?.range ? d.lineCounter.linePos(pair.key.range[0]).line : null, first: seen.get(k) });
          else seen.set(k, pair.key?.range ? d.lineCounter.linePos(pair.key.range[0]).line : null);
          walk(pair.value, [...keyPath, k], depth + 1);
        }
      }
    };
    walk(d.doc.contents, [], 0);
    return out;
  }
}

/* =================== Файлы репозитория =================== */

async function repoIndex(root) {
  const modes = new Map(); // путь → режим git (100755 — исполняемый)
  const out = await git(root, ['ls-files', '-s', '-z']).catch(() => '');
  for (const entry of out.split('\0')) {
    const m = /^(\d{6}) [0-9a-f]+ \d\t(.+)$/.exec(entry);
    if (m) modes.set(m[2], m[1]);
  }
  const dirs = new Set(['']);
  for (const p of modes.keys()) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  const norm = (p) => path.posix.normalize(String(p).replace(/\\/g, '/')).replace(/^\.\/+|^\/+/, '').replace(/\/+$/, '');
  return {
    tracked: modes.size > 0,
    // Файл в репозитории (закоммичен или лежит в рабочей папке)
    hasFile: (p) => {
      const n = norm(p);
      if (modes.has(n)) return true;
      try {
        return fs.statSync(path.join(root, n)).isFile();
      } catch {
        return false;
      }
    },
    hasDir: (p) => {
      const n = norm(p);
      if (n === '' || n === '.') return true;
      if (dirs.has(n)) return true;
      try {
        return fs.statSync(path.join(root, n)).isDirectory();
      } catch {
        return false;
      }
    },
    mode: (p) => modes.get(norm(p)) ?? null,
    read: (p) => {
      try {
        const full = path.join(root, norm(p));
        if (fs.statSync(full).size > 512 * 1024) return null;
        return fs.readFileSync(full, 'utf8');
      } catch {
        return null;
      }
    },
    glob: (pattern) => {
      const src = norm(pattern)
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, '\u0000')
        .replace(/\*\*/g, '\u0001')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/\u0000/g, '(?:.*/)?')
        .replace(/\u0001/g, '.*');
      const re = new RegExp(`^${src}$`);
      for (const p of modes.keys()) if (re.test(p)) return true;
      return false;
    },
    norm,
  };
}

/** Ветка по умолчанию: origin/HEAD, иначе main/master, если есть */
async function defaultBranch(root) {
  const head = (await git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).catch(() => '')).trim();
  if (head) return head.replace(/^[^/]+\//, '');
  for (const b of ['main', 'master']) {
    const ok = (await git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]).catch(() => '')).trim();
    if (ok) return b;
  }
  return 'main';
}

/* =================== Выражения rules:if / only:variables (GitLab) =================== */

/**
 * Разбор выражения GitLab: $VAR, "строка", 'строка', /регулярка/флаги, null, == != =~ !~ && || ( ).
 * → { ast } или { error } — с той же причиной, по которой GitLab отклонит файл.
 */
function parseExpr(src) {
  const s = String(src ?? '');
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '$') {
      const m = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/.exec(s.slice(i));
      if (!m) return { error: `после $ должно идти имя переменной (позиция ${i + 1})` };
      tokens.push({ t: 'var', v: m[1] ?? m[2] });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = s.indexOf(c, i + 1);
      if (end < 0) return { error: `не закрыта кавычка ${c} (позиция ${i + 1})` };
      tokens.push({ t: 'str', v: s.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (c === '/') {
      // регулярка: до следующего неэкранированного /
      let j = i + 1;
      while (j < s.length && (s[j] !== '/' || s[j - 1] === '\\')) j++;
      if (j >= s.length) return { error: `не закрыта регулярка /…/ (позиция ${i + 1})` };
      const body = s.slice(i + 1, j);
      const flags = /^[a-z]*/.exec(s.slice(j + 1))[0];
      try {
        new RegExp(body, flags.replace(/[^gimsuy]/g, ''));
      } catch (e) {
        return { error: `неверная регулярка /${body}/: ${e.message}` };
      }
      tokens.push({ t: 're', v: body, flags });
      i = j + 1 + flags.length;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (['==', '!=', '=~', '!~', '&&', '||'].includes(two)) {
      tokens.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if (c === '(' || c === ')') {
      tokens.push({ t: c });
      i++;
      continue;
    }
    if (/^null\b/.test(s.slice(i))) {
      tokens.push({ t: 'null' });
      i += 4;
      continue;
    }
    if (c === '=') return { error: `одиночный «=» (позиция ${i + 1}) — для сравнения нужен «==»` };
    const word = /^[A-Za-z0-9_.\-]+/.exec(s.slice(i));
    if (word) return { error: `${q(word[0])} без кавычек (позиция ${i + 1}) — строки в выражениях пишутся в кавычках: "${word[0]}"` };
    return { error: `непонятный символ ${q(c)} (позиция ${i + 1})` };
  }
  let p = 0;
  const peek = () => tokens[p];
  const operand = () => {
    const tk = tokens[p];
    if (!tk) return { error: 'выражение обрывается' };
    if (tk.t === '(') {
      p++;
      const e = orExpr();
      if (e.error) return e;
      if (tokens[p]?.t !== ')') return { error: 'не закрыта скобка (' };
      p++;
      return e;
    }
    if (['var', 'str', 're', 'null'].includes(tk.t)) {
      p++;
      return { node: tk };
    }
    return { error: `ожидалось значение, а встретилось ${q(tk.v ?? tk.t)}` };
  };
  const compare = () => {
    const left = operand();
    if (left.error) return left;
    const op = peek();
    if (op?.t === 'op' && ['==', '!=', '=~', '!~'].includes(op.v)) {
      p++;
      const right = operand();
      if (right.error) return right;
      if ((op.v === '=~' || op.v === '!~') && right.node?.t !== 're' && right.node?.t !== 'var') {
        return { error: `справа от ${op.v} должна быть регулярка /…/, а не ${right.node?.t === 'str' ? 'строка в кавычках' : 'значение'}` };
      }
      return { node: { t: 'cmp', op: op.v, left: left.node, right: right.node } };
    }
    return left;
  };
  const andExpr = () => {
    let left = compare();
    if (left.error) return left;
    while (peek()?.t === 'op' && peek().v === '&&') {
      p++;
      const right = compare();
      if (right.error) return right;
      left = { node: { t: 'and', left: left.node, right: right.node } };
    }
    return left;
  };
  function orExpr() {
    let left = andExpr();
    if (left.error) return left;
    while (peek()?.t === 'op' && peek().v === '||') {
      p++;
      const right = andExpr();
      if (right.error) return right;
      left = { node: { t: 'or', left: left.node, right: right.node } };
    }
    return left;
  }
  if (!tokens.length) return { error: 'пустое выражение' };
  const res = orExpr();
  if (res.error) return res;
  if (p < tokens.length) return { error: `лишнее после выражения: ${q(tokens[p].v ?? tokens[p].t)} — не хватает && или ||?` };
  return { ast: res.node, vars: tokens.filter((t) => t.t === 'var').map((t) => t.v) };
}

/** Значение выражения при заданных переменных (неизвестные — не заданы) */
function evalExpr(ast, vars) {
  const val = (n) => {
    if (n.t === 'var') return vars[n.v] ?? null;
    if (n.t === 'str') return n.v;
    if (n.t === 'null') return null;
    if (n.t === 're') return n;
    return ev(n);
  };
  const asRe = (v) => {
    if (v && v.t === 're') return new RegExp(v.v, v.flags.replace(/[^gimsuy]/g, ''));
    const m = /^\/(.*)\/([a-z]*)$/.exec(String(v ?? ''));
    if (m) {
      try {
        return new RegExp(m[1], m[2]);
      } catch {
        return null;
      }
    }
    return null;
  };
  const ev = (n) => {
    switch (n.t) {
      case 'var':
        return vars[n.v] != null && vars[n.v] !== '';
      case 'str':
        return n.v !== '';
      case 'null':
        return false;
      case 're':
        return true;
      case 'and':
        return ev(n.left) && ev(n.right);
      case 'or':
        return ev(n.left) || ev(n.right);
      case 'cmp': {
        const l = val(n.left);
        if (n.op === '==' || n.op === '!=') {
          const r = val(n.right);
          const eq = (l ?? null) === (r ?? null);
          return n.op === '==' ? eq : !eq;
        }
        const re = asRe(val(n.right));
        if (!re) return false;
        const hit = l != null && re.test(String(l));
        return n.op === '=~' ? hit : !hit;
      }
      default:
        return false;
    }
  };
  return ev(ast);
}

/* =================== Длительности =================== */

const DURATION_UNIT = /^(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mos|month|months|y|yr|yrs|year|years)$/i;
const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, mo: 2592000, y: 31536000 };
/** «1 week 2 days», «30m», «3600» → секунды; null — не разобрать */
function durationSeconds(value) {
  if (typeof value === 'number') return value;
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const parts = s.replace(/\band\b|,/g, ' ').match(/\d+(?:\.\d+)?\s*[a-z]+/g);
  if (!parts || parts.join('').replace(/\s/g, '') !== s.replace(/\band\b|,/g, '').replace(/\s/g, '')) return null;
  let total = 0;
  for (const part of parts) {
    const m = /^(\d+(?:\.\d+)?)\s*([a-z]+)$/.exec(part);
    if (!m || !DURATION_UNIT.test(m[2])) return null;
    const u = m[2];
    const key = /^mo/.test(u) ? 'mo' : u[0] === 'y' ? 'y' : u[0] === 'w' ? 'w' : u[0] === 'd' ? 'd' : u[0] === 'h' ? 'h' : u[0] === 'm' ? 'm' : 's';
    total += Number(m[1]) * UNIT_SECONDS[key];
  }
  return total;
}

/* =================== Секреты в открытом виде =================== */

const SECRET_NAME = /(PASS(WORD|WD)?|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIALS?|AUTH)$/i;
const SECRET_VALUE = [
  [/\bglpat-[0-9A-Za-z_-]{20,}/, 'токен GitLab (glpat-…)'],
  [/\bgh[pousr]_[0-9A-Za-z]{30,}/, 'токен GitHub (ghp_…)'],
  [/\bgithub_pat_[0-9A-Za-z_]{40,}/, 'токен GitHub (github_pat_…)'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'ключ доступа AWS (AKIA…)'],
  [/\bxox[baprs]-[0-9A-Za-z-]{10,}/, 'токен Slack'],
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, 'приватный ключ'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'ключ Google API'],
  [/\bsk_live_[0-9A-Za-z]{20,}/, 'секретный ключ Stripe'],
];
const looksLikeVarRef = (v) => /^\$\{?\{?\s*[A-Za-z_]/.test(String(v).trim()) || /\$\{\{\s*secrets\./.test(String(v));

module.exports = {
  isObj,
  arr,
  q,
  suggest,
  didYouMean,
  Positions,
  repoIndex,
  defaultBranch,
  parseExpr,
  evalExpr,
  durationSeconds,
  SECRET_NAME,
  SECRET_VALUE,
  looksLikeVarRef,
};
