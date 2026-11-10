import { useSyncExternalStore } from 'react';
import { t } from '../i18n/index.ts';

/**
 * Режимы фоновой проверки сервера и её текущее состояние.
 * Состояние меняется каждые несколько секунд — держим его в маленьком хранилище,
 * чтобы перерисовывалась только строка состояния, а не всё окно с графом.
 */

export type SyncModeId = 'realtime' | 'fast' | 'standard' | 'rare';

export interface SyncMode {
  id: SyncModeId;
  label: string;
  sec: number;
  hint: string;
}

export const SYNC_MODES: readonly SyncMode[] = [
  { id: 'realtime', label: t('Реалтайм'), sec: 5, hint: t('каждые 5 секунд') },
  { id: 'fast', label: t('Быстро'), sec: 15, hint: t('каждые 15 секунд') },
  { id: 'standard', label: t('Стандартно'), sec: 30, hint: t('каждые 30 секунд') },
  { id: 'rare', label: t('Редко'), sec: 300, hint: t('каждые 5 минут') },
];
export const DEFAULT_SYNC_MODE: SyncModeId = 'realtime';
export const BACKGROUND_SEC = 90; // окно не в фокусе или свёрнуто
export const BACKOFF_SEC: readonly number[] = [15, 30, 60, 300]; // после ошибок связи / 429

/** Неизвестный режим (старая настройка) — режим по умолчанию. */
export const syncModeById = (id: unknown): SyncMode => SYNC_MODES.find((m) => m.id === id) ?? SYNC_MODES.find((m) => m.id === DEFAULT_SYNC_MODE)!;

export interface DelayParams {
  mode: unknown;
  focused: boolean;
  failures?: number;
  /** Секунды из `Retry-After` сервера. */
  retryAfter?: number | null;
}

/** Пауза до следующей проверки, мс */
export function nextDelay({ mode, focused, failures = 0, retryAfter = 0 }: DelayParams): number {
  if (failures > 0) return Math.max(BACKOFF_SEC[Math.min(failures - 1, BACKOFF_SEC.length - 1)], retryAfter || 0) * 1000;
  const base = syncModeById(mode).sec;
  return (focused ? base : Math.max(base, BACKGROUND_SEC)) * 1000;
}

/** Состояние проверки сервера. Поля заполняет `App.jsx`: время — `Date.now()`, способ проверки и текст ошибки — строки. */
export interface SyncState {
  at: number | null;
  via: string | null;
  error: string | null;
  retryAt: number | null;
  failures: number;
  focused: boolean;
  ms: number | null;
}

let state: SyncState = { at: null, via: null, error: null, retryAt: null, failures: 0, focused: true, ms: null };
const listeners = new Set<() => void>();

export function setSyncStatus(patch: Partial<SyncState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function resetSyncStatus(): void {
  setSyncStatus({ at: null, via: null, error: null, retryAt: null, failures: 0, ms: null });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useSyncStatus(): SyncState {
  return useSyncExternalStore(subscribe, () => state);
}
