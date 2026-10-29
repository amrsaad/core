import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState } from '../state';
import type { SyncAccess } from '../useAppState';
import { loadSyncMeta, saveSyncMeta } from '../db';
import { clearToken, loadToken, saveToken, syncKey } from '../vault';
import { createSync, type Sync, type SyncStatus } from './controller';
import { canon, syncedChanged } from './merge';
import type { DigestLatest } from '../../moments/digest';

export interface SyncUi {
  status: SyncStatus;
  /** false, wenn das Token nicht wie ein GitHub-Token aussieht oder dieses Gerät den Schlüssel nicht im neuen Format hat */
  setToken(token: string): Promise<boolean>;
  removeToken(): Promise<void>;
  syncNow(): Promise<void>;
}

const IDLE: SyncStatus = { hasToken: false, lastSync: null, error: null, running: false };

/** Hängt den Sync an den App-Zustand. enabled erst, wenn Zustand und Pool-Schlüssel da sind. */
export function useSync(state: AppState | null, access: SyncAccess, enabled: boolean): SyncUi {
  const [status, setStatus] = useState<SyncStatus>(IDLE);
  const sync = useRef<Sync | null>(null);
  const prev = useRef<AppState | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const s = createSync({
      getState: access.getState,
      adopt: access.adopt,
      getKey: syncKey,
      getToken: loadToken,
      adoptDigest: (l: DigestLatest) => access.adopt((st) => (st.digestLatest && canon(st.digestLatest) === canon(l) ? st : { ...st, digestLatest: l })),
      loadMeta: loadSyncMeta,
      saveMeta: saveSyncMeta,
      onStatus: setStatus,
    });
    sync.current = s;
    const vis = () => s.visible(document.visibilityState === 'visible');
    const on = () => s.online();
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('online', on);
    (window as unknown as { __sync?: unknown }).__sync = { status: () => s.status(), syncNow: () => s.syncNow() };
    void s.start();
    return () => {
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('online', on);
      s.stop();
      sync.current = null;
    };
  }, [enabled, access]);

  // Jede Änderung an Synchronisiertem startet die 10 Sekunden von vorn
  useEffect(() => {
    if (!state) return;
    if (prev.current && syncedChanged(prev.current, state)) sync.current?.poke();
    prev.current = state;
  }, [state]);

  const setToken = useCallback(async (token: string) => {
    if (!(await saveToken(token))) return false;
    await sync.current?.tokenChanged();
    return true;
  }, []);
  const removeToken = useCallback(async () => {
    await clearToken();
    await sync.current?.tokenChanged();
  }, []);
  const syncNow = useCallback(async () => {
    await sync.current?.syncNow();
  }, []);

  return { status, setToken, removeToken, syncNow };
}
