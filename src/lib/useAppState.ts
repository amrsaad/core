import { useCallback, useEffect, useRef, useState } from 'react';
import { loadState, requestPersistence, saveState } from './db';
import type { AppState } from './state';

export function useAppState(): [AppState | null, (fn: (s: AppState) => AppState, now?: boolean) => void, (s: AppState) => void] {
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
    // Neuladen und Schließen: nicht jeder Browser meldet dabei visibilitychange
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  /** Gespeichert wird 250 ms nach der letzten Änderung, spätestens 1 s nach der ersten offenen (der Feed ändert den Zustand laufend). now: sofort. */
  const pendingSince = useRef(0);
  const persist = (s: AppState, now = false) => {
    latest.current = s;
    window.clearTimeout(timer.current);
    const t = Date.now();
    if (!pendingSince.current) pendingSince.current = t;
    const wait = now ? 0 : Math.max(0, Math.min(250, pendingSince.current + 1000 - t));
    timer.current = window.setTimeout(() => {
      pendingSince.current = 0;
      saveState(s);
    }, wait);
  };

  const update = useCallback((fn: (s: AppState) => AppState, now?: boolean) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      persist(next, now);
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
