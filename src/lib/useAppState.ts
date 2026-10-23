import { useCallback, useEffect, useRef, useState } from 'react';
import { loadState, requestPersistence, saveState } from './db';
import type { AppState } from './state';

export function useAppState(): [AppState | null, (fn: (s: AppState) => AppState) => void, (s: AppState) => void] {
  const [state, setState] = useState<AppState | null>(null);
  const timer = useRef<number>();
  const latest = useRef<AppState | null>(null);

  useEffect(() => {
    loadState().then((s) => {
      latest.current = s;
      setState(s);
    });
    requestPersistence();
    const flush = () => latest.current && saveState(latest.current);
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
  }, []);

  const persist = (s: AppState) => {
    latest.current = s;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => saveState(s), 250);
  };

  const update = useCallback((fn: (s: AppState) => AppState) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      persist(next);
      return next;
    });
  }, []);

  const replace = useCallback((s: AppState) => {
    window.clearTimeout(timer.current);
    latest.current = s;
    saveState(s);
    setState(s);
  }, []);

  return [state, update, replace];
}
