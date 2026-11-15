/**
 * Новое в 2.0: обновление списка задач, пока раздел открыт: каждые 120 с и при возврате фокуса в окно (если с прошлого
 * запроса прошло больше 60 с), только в видимом окне. После `RATE_LIMIT` автообновление ждёт 10 минут. После входа на
 * сервер (`forge.token.configured` стал `true`) — сразу полное обновление и свежие метки, вехи, участники.
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { issuesStore } from '../../state/issuesStore.ts';

const REFRESH_EVERY = 120_000;
const REFRESH_ON_FOCUS_AFTER = 60_000;
/** Сервер ограничил число запросов — автообновление ждёт 10 минут. */
export const RATE_LIMIT_PAUSE = 10 * 60_000;

const visible = () => document.visibilityState === 'visible';

export function useIssuesRefresh(repoPath: string, errorCode: string | null, signedIn: boolean, lastFetch: MutableRefObject<number>) {
  const store = issuesStore.getState;
  const refresh = useCallback(
    (silent: boolean) => {
      lastFetch.current = Date.now();
      void store().refresh(repoPath, { silent });
    },
    [repoPath, store, lastFetch],
  );

  const pausedUntil = useRef(0);
  const limited = errorCode === 'RATE_LIMIT';
  useEffect(() => {
    if (limited) pausedUntil.current = Date.now() + RATE_LIMIT_PAUSE;
  }, [limited]);

  useEffect(() => {
    const auto = () => visible() && Date.now() >= pausedUntil.current;
    const timer = setInterval(() => auto() && refresh(true), REFRESH_EVERY);
    const onFocus = () => auto() && Date.now() - lastFetch.current > REFRESH_ON_FOCUS_AFTER && refresh(true);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh, lastFetch]);

  const wasSignedIn = useRef(signedIn);
  useEffect(() => {
    if (signedIn && !wasSignedIn.current) {
      refresh(false);
      void store().loadMeta(repoPath, { force: true });
    }
    wasSignedIn.current = signedIn;
  }, [signedIn, refresh, repoPath, store]);

  return { refresh, limited };
}
