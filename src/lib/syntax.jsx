// Минимальная подсветка YAML и Groovy (Jenkinsfile) для просмотра и редактора CI

/* =================== Подсветка синтаксиса (минимальная) =================== */

const T = {
  comment: 'text-gk-dim italic',
  key: 'text-[var(--syn-key)]',
  string: 'text-[var(--syn-string)]',
  number: 'text-[var(--syn-number)]',
  keyword: 'text-[var(--syn-keyword)]',
  variable: 'text-[var(--syn-variable)]',
  anchor: 'text-[var(--syn-anchor)]',
  punct: 'text-gk-dim',
};

function tokenizeValue(text, out, keyPrefix) {
  // Строки в кавычках, переменные $VAR / ${{ }}, якоря/теги, числа и булевы
  const re = /("(?:[^"\\]|\\.)*"|'(?:[^']|'')*')|(\$\{\{[^}]*\}\}|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?)|([&*][\w-]+|![\w-]+)|(\b(?:true|false|null|yes|no|on|off)\b|\b\d+(?:\.\d+)?\b)/g;
  let last = 0;
  let m;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const cls = m[1] ? T.string : m[2] ? T.variable : m[3] ? T.anchor : T.number;
    out.push(
      <span key={`${keyPrefix}-${k++}`} className={cls}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
}

export function highlight(line, lang) {
  if (!line) return line;
  const out = [];
  if (lang === 'yaml') {
    // Комментарий: # в начале или после пробела, не внутри кавычек (приблизительно)
    let code = line;
    let comment = '';
    const cm = /(^|\s)#/.exec(line);
    if (cm && !/["'][^"']*#/.test(line.slice(0, cm.index + cm[0].length))) {
      code = line.slice(0, cm.index + cm[1].length);
      comment = line.slice(cm.index + cm[1].length);
    }
    const km = /^(\s*(?:-\s+)?)([^\s#'"][^:#]*?|"[^"]*"|'[^']*')(:)(?=\s|$)/.exec(code);
    if (km) {
      out.push(
        <span key="d" className={T.punct}>
          {km[1]}
        </span>,
      );
      out.push(
        <span key="k" className={T.key}>
          {km[2]}
        </span>,
      );
      out.push(
        <span key="c" className={T.punct}>
          :
        </span>,
      );
      tokenizeValue(code.slice(km[0].length), out, 'v');
    } else {
      const dm = /^(\s*-\s)/.exec(code);
      if (dm) {
        out.push(
          <span key="d" className={T.punct}>
            {dm[1]}
          </span>,
        );
        tokenizeValue(code.slice(dm[1].length), out, 'v');
      } else tokenizeValue(code, out, 'v');
    }
    if (comment)
      out.push(
        <span key="cm" className={T.comment}>
          {comment}
        </span>,
      );
    return out;
  }
  // Groovy / Jenkinsfile
  const cm = line.indexOf('//');
  const code = cm >= 0 ? line.slice(0, cm) : line;
  const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(pipeline|agent|stages?|steps|parallel|post|when|environment|options|triggers|tools|parameters|script|node|def|if|else|always|success|failure|input|sh|bat|echo)\b/g;
  let last = 0;
  let m;
  let k = 0;
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    out.push(
      <span key={k++} className={m[1] ? T.string : T.keyword}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < code.length) out.push(code.slice(last));
  if (cm >= 0)
    out.push(
      <span key="cm" className={T.comment}>
        {line.slice(cm)}
      </span>,
    );
  return out;
}
