import { useCallback, useState } from 'react';
import { t } from '../i18n/index.js';

/**
 * Настройки вида таблицы коммитов: какие колонки видны, в каком порядке,
 * плотность строк, формат даты и стиль узлов графа. Хранятся в localStorage.
 * Ширины колонок живут отдельно (useStoredWidth) — их сбрасывает «Сбросить ширину и вид колонок».
 */

export const COLUMNS = [
  { id: 'refs', label: t('Ветка / тег') },
  { id: 'graph', label: t('Граф') },
  { id: 'message', label: t('Сообщение коммита'), locked: true }, // всегда видна и забирает свободное место
  { id: 'sha', label: 'SHA', menuLabel: t('SHA (хэш коммита)') },
  { id: 'author', label: t('Автор') },
  { id: 'date', label: t('Дата / время') },
];
export const COLUMN_IDS = COLUMNS.map((c) => c.id);
export const columnById = (id) => COLUMNS.find((c) => c.id === id);

export const DENSITY_OPTIONS = [
  { id: 'compact', label: t('Компактный'), hint: '26px' },
  { id: 'standard', label: t('Стандартный'), hint: '34px' },
  { id: 'relaxed', label: t('Свободный'), hint: '42px' },
];
export const DATE_FORMAT_OPTIONS = [
  { id: 'absolute', label: t('Абсолютный'), hint: '26.10.26 23:13' },
  { id: 'relative', label: t('Относительный'), hint: t('15 мин назад, вчера') },
];
export const NODE_STYLE_OPTIONS = [
  { id: 'avatar', label: t('Аватары / инициалы') },
  { id: 'dots', label: t('Компактные точки') },
];

export const DEFAULT_VIEW = {
  order: ['refs', 'graph', 'message', 'sha', 'author', 'date'],
  hidden: ['sha'],
  density: 'standard',
  dateFormat: 'absolute',
  nodeStyle: 'avatar',
};

const KEY = 'graph.view.v1';
const pick = (value, options, fallback) => (options.some((o) => o.id === value) ? value : fallback);

/** Приводит сохранённое к допустимому виду: все колонки ровно по разу, сообщение всегда видно */
export function normalizeView(raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const order = Array.isArray(v.order) ? v.order.filter((id, i, a) => COLUMN_IDS.includes(id) && a.indexOf(id) === i) : [];
  for (const id of DEFAULT_VIEW.order) if (!order.includes(id)) order.splice(Math.min(DEFAULT_VIEW.order.indexOf(id), order.length), 0, id);
  const hidden = Array.isArray(v.hidden) ? v.hidden.filter((id, i, a) => COLUMN_IDS.includes(id) && id !== 'message' && a.indexOf(id) === i) : [...DEFAULT_VIEW.hidden];
  return {
    order,
    hidden,
    density: pick(v.density, DENSITY_OPTIONS, DEFAULT_VIEW.density),
    dateFormat: pick(v.dateFormat, DATE_FORMAT_OPTIONS, DEFAULT_VIEW.dateFormat),
    nodeStyle: pick(v.nodeStyle, NODE_STYLE_OPTIONS, DEFAULT_VIEW.nodeStyle),
  };
}

/** Переставляет колонку: from встаёт перед (before) или после target */
export function moveColumn(order, from, target, after = false) {
  if (from === target || !order.includes(from) || !order.includes(target)) return order;
  const next = order.filter((id) => id !== from);
  const at = next.indexOf(target) + (after ? 1 : 0);
  next.splice(at, 0, from);
  return next;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return normalizeView(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeView(null);
  }
}

export function useGraphView() {
  const [view, setView] = useState(load);
  const update = useCallback((patch) => {
    setView((prev) => {
      const next = normalizeView({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) });
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* хранилище недоступно — вид просто не запомнится */
      }
      return next;
    });
  }, []);
  return [view, update];
}
