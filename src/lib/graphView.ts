import { useCallback, useSyncExternalStore } from 'react';
import { t } from '../i18n/index.ts';
import type { DensityId } from './graphLayout.ts';

/**
 * Настройки вида таблицы коммитов: какие колонки видны, в каком порядке,
 * плотность строк, формат даты и стиль узлов графа. Хранятся в localStorage.
 * Ширины колонок живут отдельно (useStoredWidth) — их сбрасывает «Сбросить ширину и вид колонок».
 * Новое в 2.0 — раздел «Показывать»: метки серверных веток, метки тегов, stash в графе (по умолчанию всё видно, как в 1.x).
 * Вид общий для всего окна: «Stash в графе» читает `App`, а меняет меню вида внутри `CommitGraph`.
 */

export type ColumnId = 'refs' | 'graph' | 'message' | 'sha' | 'author' | 'date';
export type DateFormat = 'absolute' | 'relative';
export type NodeStyle = 'avatar' | 'dots';

export interface Column {
  id: ColumnId;
  label: string;
  menuLabel?: string;
  /** Всегда видна и забирает свободное место. */
  locked?: boolean;
}

export interface ViewOption<Id extends string> {
  id: Id;
  label: string;
  hint?: string;
}

export const COLUMNS: readonly Column[] = [
  { id: 'refs', label: t('branch-tag') },
  { id: 'graph', label: t('graph') },
  { id: 'message', label: t('commit-message-2'), locked: true }, // всегда видна и забирает свободное место
  { id: 'sha', label: 'SHA', menuLabel: t('sha-commit-hash') },
  { id: 'author', label: t('author-3') },
  { id: 'date', label: t('date-time') },
];
export const COLUMN_IDS: readonly ColumnId[] = COLUMNS.map((c) => c.id);
export const columnById = (id: unknown): Column | undefined => COLUMNS.find((c) => c.id === id);

export const DENSITY_OPTIONS: readonly ViewOption<DensityId>[] = [
  { id: 'compact', label: t('compact'), hint: '26px' },
  { id: 'standard', label: t('standard'), hint: '34px' },
  { id: 'relaxed', label: t('roomy'), hint: '42px' },
];
export const DATE_FORMAT_OPTIONS: readonly ViewOption<DateFormat>[] = [
  { id: 'absolute', label: t('absolute'), hint: '26.10.26 23:13' },
  { id: 'relative', label: t('relative'), hint: t('n-15-min-ago-yesterday') },
];
export const NODE_STYLE_OPTIONS: readonly ViewOption<NodeStyle>[] = [
  { id: 'avatar', label: t('avatars-initials') },
  { id: 'dots', label: t('compact-dots') },
];

export interface GraphView {
  order: ColumnId[];
  hidden: ColumnId[];
  density: DensityId;
  dateFormat: DateFormat;
  nodeStyle: NodeStyle;
  /** Метки серверных веток (коммиты остаются) */
  showRemote: boolean;
  /** Метки тегов (коммиты остаются) */
  showTags: boolean;
  /** Строки stash в графе */
  showStash: boolean;
}

/** Переключатели раздела «Показывать» меню вида */
export type GraphViewFlag = 'showRemote' | 'showTags' | 'showStash';

export const DEFAULT_VIEW: Readonly<GraphView> = {
  order: ['refs', 'graph', 'message', 'sha', 'author', 'date'],
  hidden: ['sha'],
  density: 'standard',
  dateFormat: 'absolute',
  nodeStyle: 'avatar',
  showRemote: true,
  showTags: true,
  showStash: true,
};

const KEY = 'graph.view.v1';
const pick = <Id extends string>(value: unknown, options: readonly ViewOption<Id>[], fallback: Id): Id =>
  options.some((o) => o.id === value) ? (value as Id) : fallback;
const isColumn = (id: unknown): id is ColumnId => COLUMN_IDS.includes(id as ColumnId);

/** Приводит сохранённое к допустимому виду: все колонки ровно по разу, сообщение всегда видно */
export function normalizeView(raw: unknown): GraphView {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof GraphView, unknown>>;
  const order: ColumnId[] = Array.isArray(v.order) ? v.order.filter((id, i, a): id is ColumnId => isColumn(id) && a.indexOf(id) === i) : [];
  for (const id of DEFAULT_VIEW.order) if (!order.includes(id)) order.splice(Math.min(DEFAULT_VIEW.order.indexOf(id), order.length), 0, id);
  const hidden: ColumnId[] = Array.isArray(v.hidden)
    ? v.hidden.filter((id, i, a): id is ColumnId => isColumn(id) && id !== 'message' && a.indexOf(id) === i)
    : [...DEFAULT_VIEW.hidden];
  return {
    order,
    hidden,
    density: pick(v.density, DENSITY_OPTIONS, DEFAULT_VIEW.density),
    dateFormat: pick(v.dateFormat, DATE_FORMAT_OPTIONS, DEFAULT_VIEW.dateFormat),
    nodeStyle: pick(v.nodeStyle, NODE_STYLE_OPTIONS, DEFAULT_VIEW.nodeStyle),
    // Не булево (старая настройка без этих полей, мусор) — по умолчанию: всё видно
    showRemote: typeof v.showRemote === 'boolean' ? v.showRemote : DEFAULT_VIEW.showRemote,
    showTags: typeof v.showTags === 'boolean' ? v.showTags : DEFAULT_VIEW.showTags,
    showStash: typeof v.showStash === 'boolean' ? v.showStash : DEFAULT_VIEW.showStash,
  };
}

/** Переставляет колонку: from встаёт перед (before) или после target */
export function moveColumn<Id>(order: readonly Id[], from: Id, target: Id, after = false): readonly Id[] {
  if (from === target || !order.includes(from) || !order.includes(target)) return order;
  const next = order.filter((id) => id !== from);
  const at = next.indexOf(target) + (after ? 1 : 0);
  next.splice(at, 0, from);
  return next;
}

function load(): GraphView {
  try {
    const raw = localStorage.getItem(KEY);
    return normalizeView(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeView(null);
  }
}

export type GraphViewPatch = Partial<GraphView> | ((prev: GraphView) => Partial<GraphView>);

// Один вид на окно: читается при первом обращении, изменения расходятся всем подписчикам
let current: GraphView | null = null;
const listeners = new Set<() => void>();
const snapshot = () => (current ??= load());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useGraphView(): [GraphView, (patch: GraphViewPatch) => void] {
  const view = useSyncExternalStore(subscribe, snapshot);
  const update = useCallback((patch: GraphViewPatch) => {
    const prev = snapshot();
    const next = normalizeView({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) });
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* хранилище недоступно — вид просто не запомнится */
    }
    current = next;
    listeners.forEach((fn) => fn());
  }, []);
  return [view, update];
}
