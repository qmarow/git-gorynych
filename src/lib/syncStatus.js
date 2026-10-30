import { useSyncExternalStore } from 'react';

/**
 * Режимы фоновой проверки сервера и её текущее состояние.
 * Состояние меняется каждые несколько секунд — держим его в маленьком хранилище,
 * чтобы перерисовывалась только строка состояния, а не всё окно с графом.
 */

export const SYNC_MODES = [
  { id: 'realtime', label: 'Реалтайм', sec: 5, hint: 'каждые 5 секунд' },
  { id: 'fast', label: 'Быстро', sec: 15, hint: 'каждые 15 секунд' },
  { id: 'standard', label: 'Стандартно', sec: 30, hint: 'каждые 30 секунд' },
  { id: 'rare', label: 'Редко', sec: 300, hint: 'каждые 5 минут' },
];
export const DEFAULT_SYNC_MODE = 'realtime';
export const BACKGROUND_SEC = 90; // окно не в фокусе или свёрнуто
export const BACKOFF_SEC = [15, 30, 60, 300]; // после ошибок связи / 429

export const syncModeById = (id) => SYNC_MODES.find((m) => m.id === id) ?? SYNC_MODES.find((m) => m.id === DEFAULT_SYNC_MODE);

/** Пауза до следующей проверки, мс */
export function nextDelay({ mode, focused, failures = 0, retryAfter = 0 }) {
  if (failures > 0) return Math.max(BACKOFF_SEC[Math.min(failures - 1, BACKOFF_SEC.length - 1)], retryAfter || 0) * 1000;
  const base = syncModeById(mode).sec;
  return (focused ? base : Math.max(base, BACKGROUND_SEC)) * 1000;
}

let state = { at: null, via: null, error: null, retryAt: null, failures: 0, focused: true, ms: null };
const listeners = new Set();

export function setSyncStatus(patch) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function resetSyncStatus() {
  setSyncStatus({ at: null, via: null, error: null, retryAt: null, failures: 0, ms: null });
}

const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useSyncStatus() {
  return useSyncExternalStore(subscribe, () => state);
}
