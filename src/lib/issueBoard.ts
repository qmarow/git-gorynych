/**
 * Новое в 2.0: доска задач — колонки «Открытые», метки-колонки (выбор пользователя, не больше 8) и «Закрытые».
 *
 * - `columnsFor(issues, labelColumns)`: закрытая задача — в «Закрытые»; открытая с меткой-колонкой — в первую подходящую
 *   колонку по порядку колонок; остальные открытые — в «Открытые». Порядок задач внутри колонки — как во входе.
 * - `patchForMove(issue, from, to, labelColumns)`: правка задачи при переносе карточки. В «Закрытые» — закрыть; из
 *   «Закрытых» — открыть и (если цель — метка) поставить метку; между метками — снять старую, поставить новую; в
 *   «Открытые» — снять все метки-колонки. Перенос в ту же колонку или без изменений — `null`.
 * - Колонки репозитория — `localStorage['issues.board.v1:<путь>']`, массив имён меток.
 * Проверка — `tests/ui-parity/lib-issue-board.mjs`.
 */
import type { IssueLabel_Serialize } from '../../crates/gorynych-tauri/bindings/commands.ts';
import type { Issue, IssuePatch } from './issues.ts';

export const MAX_LABEL_COLUMNS = 8;
export const BOARD_PREFIX = 'issues.board.v1:';

export type ColumnId = 'open' | 'closed' | `label:${string}`;

export interface BoardColumn {
  id: ColumnId;
  /** Имя метки у колонки-метки. */
  label: string | null;
  items: Issue[];
}

export const labelColumnId = (name: string): ColumnId => `label:${name}`;
const labelOf = (id: ColumnId): string | null => (id.startsWith('label:') ? id.slice(6) : null);
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Колонки без повторов (без учёта регистра) и не больше 8. */
export function normalizeColumns(names: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    if (typeof name !== 'string' || !name.trim() || out.some((x) => sameName(x, name))) continue;
    out.push(name);
    if (out.length === MAX_LABEL_COLUMNS) break;
  }
  return out;
}

export function columnsFor(issues: readonly Issue[], labelColumns: readonly string[]): BoardColumn[] {
  const labels = normalizeColumns(labelColumns);
  const columns: BoardColumn[] = [{ id: 'open', label: null, items: [] }, ...labels.map((name) => ({ id: labelColumnId(name), label: name, items: [] as Issue[] })), { id: 'closed', label: null, items: [] }];
  const byId = new Map(columns.map((c) => [c.id, c]));
  for (const issue of issues) {
    if (issue.state === 'closed') {
      byId.get('closed')!.items.push(issue);
      continue;
    }
    const name = labels.find((col) => issue.labels.some((l) => sameName(l.name, col)));
    byId.get(name ? labelColumnId(name) : 'open')!.items.push(issue);
  }
  return columns;
}

/** Колонка задачи — та же, что даёт `columnsFor`. */
export function columnOf(issue: Pick<Issue, 'state' | 'labels'>, labelColumns: readonly string[]): ColumnId {
  if (issue.state === 'closed') return 'closed';
  const name = normalizeColumns(labelColumns).find((col) => issue.labels.some((l) => sameName(l.name, col)));
  return name ? labelColumnId(name) : 'open';
}

const ref = (l: Pick<IssueLabel_Serialize, 'id' | 'name'>) => ({ id: l.id, name: l.name });

/** Правка задачи при переносе карточки из `from` в `to`; `known` — метки репозитория (для `id` новой метки). */
export function patchForMove(
  issue: Pick<Issue, 'state' | 'labels'>,
  from: ColumnId,
  to: ColumnId,
  labelColumns: readonly string[],
  known: readonly Pick<IssueLabel_Serialize, 'id' | 'name'>[] = [],
): IssuePatch | null {
  if (from === to) return null;
  const columns = normalizeColumns(labelColumns);
  const isColumn = (name: string) => columns.some((c) => sameName(c, name));
  if (to === 'closed') return issue.state === 'closed' ? null : { state: 'closed' };
  const target = labelOf(to);
  const patch: IssuePatch = {};
  if (issue.state === 'closed') patch.state = 'open';
  // Метки: в «Открытые» — без меток-колонок; в колонку-метку — без прежних меток-колонок и с меткой цели
  let labels: Pick<IssueLabel_Serialize, 'id' | 'name'>[] = issue.labels.filter((l) => !isColumn(l.name) || (target != null && sameName(l.name, target)));
  if (target != null && !labels.some((l) => sameName(l.name, target))) {
    const label = known.find((l) => sameName(l.name, target)) ?? { id: target, name: target };
    labels = [...labels, label];
  }
  const changed = labels.length !== issue.labels.length || labels.some((l, i) => l.name !== issue.labels[i]?.name);
  if (changed) patch.labels = labels.map(ref);
  return Object.keys(patch).length ? patch : null;
}

export function readBoardColumns(path: string): string[] {
  try {
    const raw = localStorage.getItem(BOARD_PREFIX + path);
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? normalizeColumns(value) : [];
  } catch {
    return [];
  }
}

export function writeBoardColumns(path: string, names: readonly string[]): void {
  try {
    const value = normalizeColumns(names);
    if (value.length) localStorage.setItem(BOARD_PREFIX + path, JSON.stringify(value));
    else localStorage.removeItem(BOARD_PREFIX + path);
  } catch {
    /* хранилище недоступно — колонки до перезапуска */
  }
}
