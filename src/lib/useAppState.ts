import { useCallback, useEffect, useRef, useState } from 'react';
import { loadState, requestPersistence, saveState } from './db';
import type { AppState } from './state';
import { stampChanges } from './sync/merge';

/** Zugriff für den Geräte-Sync: jüngster Zustand und Änderung ohne neue Zeitstempel (Übernahme von GitHub) */
export interface SyncAccess {
  getState: () => AppState | null;
  adopt: (fn: (s: AppState) => AppState) => void;
}

/** Während eines Wischs (Ziehen und Auslaufen) wird nicht gespeichert: der Zustand bleibt im Speicher, das Schreiben in IndexedDB wartet. */
export const saveGate = { busy: false };

export function useAppState(): [AppState | null, (fn: (s: AppState) => AppState, now?: boolean) => void, (s: AppState) => void, SyncAccess] {
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
    const run = () => {
      // Wisch läuft: später noch einmal versuchen (der jüngste Zustand steht in latest)
      if (saveGate.busy) {
        timer.current = window.setTimeout(run, 120);
        return;
      }
      pendingSince.current = 0;
      saveState(latest.current ?? s);
    };
    timer.current = window.setTimeout(run, wait);
  };

  const update = useCallback((fn: (s: AppState) => AppState, now?: boolean) => {
    setState((prev) => {
      if (!prev) return prev;
      // Zeitstempel für den Geräte-Sync an einer Stelle: was sich geändert hat, bekommt die Zeit der Änderung
      const next = stampChanges(prev, fn(prev), Date.now());
      persist(next, now);
      return next;
    });
  }, []);

  const replace = useCallback((s: AppState) => {
    window.clearTimeout(timer.current);
    const next = latest.current ? stampChanges(latest.current, s, Date.now()) : s;
    latest.current = next;
    saveState(next);
    setState(next);
  }, []);

  /** Übernahme vom anderen Gerät: keine neuen Zeitstempel, sofort gespeichert, gleicher Zustand bleibt gleich */
  const adopt = useCallback((fn: (s: AppState) => AppState) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      if (next !== prev) persist(next, true);
      return next;
    });
  }, []);

  const access = useRef<SyncAccess>({ getState: () => latest.current, adopt });

  return [state, update, replace, access.current];
}
